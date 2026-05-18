/**
 * API-key authentication middleware for the gateway.
 *
 * Resolves a Bearer token to a platform AuthContext by looking up
 * the hashed key in the `api_keys` table, then loading the user's
 * Forgejo token from the linked account.
 *
 * Routes that don't need auth (health, webhooks) skip this middleware.
 */

import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { users, accounts, apiKeys, syncConnections } from "@openforge/db";
import type { AuthContext } from "@openforge/platform";
import { decryptTokenSafe } from "@openforge/shared/lib/encryption";
import { getPlatform } from "../platform";

export type GatewayEnv = {
  Variables: {
    auth: AuthContext;
  };
};

/**
 * Extract the bearer token from the Authorization header.
 * Accepts: `Bearer <token>` or raw `<token>`.
 */
function extractToken(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (!header) return null;
  return header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : header.trim();
}

function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Middleware: require a valid API key in the Authorization header.
 *
 * Resolution order:
 * 1. GATEWAY_API_SECRET shared secret (admin fallback for bootstrapping)
 * 2. Per-user hashed key lookup in the `api_keys` table
 */
export const requireApiAuth = createMiddleware<GatewayEnv>(async (c, next) => {
  const token = extractToken(c);
  if (!token) {
    return c.json({ error: "Missing Authorization header" }, 401);
  }

  const gatewaySecret = process.env.GATEWAY_API_SECRET;

  if (gatewaySecret && safeEqual(token, gatewaySecret)) {
    const impersonateUserId = c.req.header("X-OpenForge-User-Id");
    const auth = impersonateUserId
      ? await resolveUserAuth(impersonateUserId)
      : await resolveAdminAuth();
    if (!auth) {
      return c.json(
        { error: impersonateUserId ? "User not found" : "Admin user not configured" },
        impersonateUserId ? 404 : 503,
      );
    }
    c.set("auth", auth);
    return next();
  }

  const auth = await resolveApiKeyAuth(token);
  if (!auth) {
    return c.json({ error: "Invalid API key" }, 401);
  }
  c.set("auth", auth);
  return next();
});

async function resolveAdminAuth(): Promise<AuthContext | null> {
  const db = getPlatform().db;
  const [admin] = await db
    .select({
      id: users.id,
      forgejoUsername: users.forgejoUsername,
      isAdmin: users.isAdmin,
    })
    .from(users)
    .where(eq(users.isAdmin, true))
    .limit(1);

  if (!admin) return null;

  const forgeInfo = await resolveForgeTokenInfo(db, admin.id);
  if (!forgeInfo) return null;

  return {
    userId: admin.id,
    username: admin.forgejoUsername ?? "admin",
    forgeToken: forgeInfo.token,
    forgeType: forgeInfo.forgeType,
    isAdmin: true,
  };
}

async function resolveUserAuth(userId: string): Promise<AuthContext | null> {
  const db = getPlatform().db;
  const [user] = await db
    .select({
      id: users.id,
      forgejoUsername: users.forgejoUsername,
      isAdmin: users.isAdmin,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  const forgeInfo = await resolveForgeTokenInfo(db, user.id);
  if (!forgeInfo) return null;

  return {
    userId: user.id,
    username: user.forgejoUsername ?? "unknown",
    forgeToken: forgeInfo.token,
    forgeType: forgeInfo.forgeType,
    isAdmin: user.isAdmin ?? false,
  };
}

async function resolveApiKeyAuth(
  token: string,
): Promise<AuthContext | null> {
  const db = getPlatform().db;
  const hashed = hashApiKey(token);

  const [keyRow] = await db
    .select({ userId: apiKeys.userId, expiresAt: apiKeys.expiresAt })
    .from(apiKeys)
    .where(eq(apiKeys.hashedKey, hashed))
    .limit(1);

  if (!keyRow) return null;

  if (keyRow.expiresAt && keyRow.expiresAt < new Date()) {
    return null;
  }

  const [user] = await db
    .select({
      id: users.id,
      forgejoUsername: users.forgejoUsername,
      isAdmin: users.isAdmin,
    })
    .from(users)
    .where(eq(users.id, keyRow.userId))
    .limit(1);

  if (!user) return null;

  const forgeInfo = await resolveForgeTokenInfo(db, user.id);
  if (!forgeInfo) return null;

  // Update last_used_at in background
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.hashedKey, hashed))
    .catch(() => {});

  return {
    userId: user.id,
    username: user.forgejoUsername ?? "unknown",
    forgeToken: forgeInfo.token,
    forgeType: forgeInfo.forgeType,
    isAdmin: user.isAdmin ?? false,
  };
}

type ForgeTokenInfo = {
  token: string;
  forgeType: "forgejo" | "github" | "gitlab";
};

/**
 * Look up a forge access token for a user.
 * Checks GitHub/GitLab OAuth accounts first, then sync connections,
 * and only falls back to Forgejo as a last resort.
 */
async function resolveForgeTokenInfo(
  db: ReturnType<typeof getPlatform>["db"],
  userId: string,
): Promise<ForgeTokenInfo | null> {
  const [accountRows, connRows] = await Promise.all([
    db
      .select({ provider: accounts.provider, accessToken: accounts.access_token })
      .from(accounts)
      .where(eq(accounts.userId, userId)),
    db
      .select({ provider: syncConnections.provider, accessToken: syncConnections.accessToken })
      .from(syncConnections)
      .where(eq(syncConnections.userId, userId)),
  ]);

  for (const provider of ["github", "gitlab"] as const) {
    const acct = accountRows.find((r) => r.provider === provider);
    if (acct?.accessToken) return { token: decryptTokenSafe(acct.accessToken), forgeType: provider };
  }
  for (const provider of ["github", "gitlab"] as const) {
    const conn = connRows.find((r) => r.provider === provider);
    if (conn?.accessToken) return { token: decryptTokenSafe(conn.accessToken), forgeType: provider };
  }
  const forgejo = accountRows.find((r) => r.provider === "forgejo");
  if (forgejo?.accessToken) return { token: decryptTokenSafe(forgejo.accessToken), forgeType: "forgejo" };
  return null;
}

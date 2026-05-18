/**
 * Manually bootstrap the first admin user.
 *
 * Normally this runs automatically on first startup via instrumentation.ts.
 * Use this script for manual runs or CI environments where the app isn't
 * starting up (e.g., database seeding before deploy).
 *
 * Usage:
 *   bun run apps/web/scripts/bootstrap-admin.ts
 *
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD from the environment (same vars the
 * auto-bootstrap uses). Falls back to .env.local in the web app.
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import * as schema from "@openforge/db/schema";
import { encryptToken } from "@openforge/shared/lib/encryption";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  console.error("ADMIN_EMAIL and ADMIN_PASSWORD env vars are required.");
  console.error("Set them in .env.local or pass them directly:");
  console.error("  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=… bun run apps/web/scripts/bootstrap-admin.ts");
  process.exit(1);
}

const FORGEJO_URL = process.env.FORGEJO_INTERNAL_URL ?? "http://localhost:3000";
const AGENT_TOKEN = process.env.FORGEJO_AGENT_TOKEN;
if (!AGENT_TOKEN) { console.error("FORGEJO_AGENT_TOKEN required"); process.exit(1); }

const ADMIN_USERNAME = "forge-admin";
const ADMIN_FORGEJO_PASSWORD =
  process.env.FORGEJO_ADMIN_PASSWORD ?? "admin-password-change-me";

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

async function forgejoApi(path: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${FORGEJO_URL}/api/v1${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `token ${AGENT_TOKEN}`,
      ...(opts.headers as Record<string, string> ?? {}),
    },
  });
}

async function ensureForgejoUser(): Promise<{ id: number; login: string }> {
  const existing = await forgejoApi(`/users/${ADMIN_USERNAME}`);
  if (existing.ok) {
    const data = await existing.json() as { id: number; login: string };
    console.log(`Forgejo user "${ADMIN_USERNAME}" already exists (id=${data.id})`);
    return data;
  }

  const res = await forgejoApi("/admin/users", {
    method: "POST",
    body: JSON.stringify({
      username: ADMIN_USERNAME,
      password: ADMIN_FORGEJO_PASSWORD,
      email,
      must_change_password: false,
      login_name: ADMIN_USERNAME,
      source_id: 0,
      visibility: "public",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create Forgejo user: ${res.status} ${body}`);
  }

  const data = await res.json() as { id: number; login: string };
  console.log(`Created Forgejo user "${data.login}" (id=${data.id})`);
  return data;
}

async function createForgejoToken(): Promise<string> {
  const basicAuth = Buffer.from(
    `${ADMIN_USERNAME}:${ADMIN_FORGEJO_PASSWORD}`,
  ).toString("base64");

  const res = await fetch(`${FORGEJO_URL}/api/v1/users/${ADMIN_USERNAME}/tokens`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${basicAuth}`,
    },
    body: JSON.stringify({
      name: `admin-bootstrap-${Date.now()}`,
      scopes: ["all"],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create Forgejo token: ${res.status} ${body}`);
  }

  const data = await res.json() as { sha1: string };
  return data.sha1;
}

async function main() {
  console.log("=== Bootstrap Admin User ===\n");

  const forgejoUser = await ensureForgejoUser();
  const forgejoToken = await createForgejoToken();
  const encForgeToken = encryptToken(forgejoToken);
  console.log(`Forgejo API token created for ${forgejoUser.login}`);

  const passwordHash = await bcrypt.hash(password!, 12);
  const userId = crypto.randomUUID();
  const normalizedEmail = email!.toLowerCase();

  const [existing] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, normalizedEmail))
    .limit(1);

  if (existing) {
    await db
      .update(schema.users)
      .set({
        passwordHash,
        forgejoUserId: forgejoUser.id,
        forgejoUsername: forgejoUser.login,
        isAdmin: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, existing.id));

    await db
      .insert(schema.accounts)
      .values({
        userId: existing.id,
        type: "oauth",
        provider: "forgejo",
        providerAccountId: String(forgejoUser.id),
        access_token: encForgeToken,
      })
      .onConflictDoUpdate({
        target: [schema.accounts.provider, schema.accounts.providerAccountId],
        set: { access_token: encForgeToken },
      });

    console.log(`\nUpdated existing user: ${existing.id} (${normalizedEmail})`);
  } else {
    await db.insert(schema.users).values({
      id: userId,
      name: "Admin",
      email: normalizedEmail,
      forgejoUserId: forgejoUser.id,
      forgejoUsername: forgejoUser.login,
      passwordHash,
      isAdmin: true,
    });

    await db.insert(schema.accounts).values({
      userId,
      type: "oauth",
      provider: "forgejo",
      providerAccountId: String(forgejoUser.id),
      access_token: encForgeToken,
    });

    console.log(`\nCreated admin user: ${userId} (${normalizedEmail})`);
  }

  console.log("\n=== Done ===");
  console.log(`Sign in with: ${normalizedEmail}`);

  await client.end();
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});

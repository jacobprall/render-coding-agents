/**
 * Singleton PlatformContainer for the Next.js app.
 *
 * Reuses the existing `getDb()` and `getSharedRedisClient()` singletons
 * so the app keeps its current connection lifecycle and there is no extra
 * pool.
 */

import { createPlatformFromInstances, type PlatformContainer } from "@coding-agents/platform/container";
import type { AuthContext } from "@coding-agents/platform";
import { getDb } from "@/lib/db";
import { getSharedRedisClient } from "@/lib/redis";
import { auth } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Container singleton
// ---------------------------------------------------------------------------

const globalForPlatform = globalThis as unknown as { __platform?: PlatformContainer };

export function getPlatform(): PlatformContainer {
  if (!globalForPlatform.__platform) {
    globalForPlatform.__platform = createPlatformFromInstances({
      db: getDb(),
      redis: getSharedRedisClient(),
    });
  }
  return globalForPlatform.__platform;
}

// ---------------------------------------------------------------------------
// Auth bridge: NextAuth session → AuthContext
// ---------------------------------------------------------------------------

/**
 * Resolve the current NextAuth session into a platform `AuthContext`.
 * Requires both identity AND a forge token. Throws 401/403 if missing.
 * Use for routes that need repo access (sessions, repos, agent actions).
 */
export async function requireForgeAuth(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!session.forgeToken) {
    throw new Response(
      JSON.stringify({ error: "GitHub not connected. Please connect GitHub in Settings > Connections." }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }
  return {
    userId: session.user.id,
    username: session.forgeUsername,
    forgeToken: session.forgeToken,
    forgeType: session.forgeType ?? "github",
    isAdmin: session.isAdmin,
  };
}

/**
 * Identity-only auth. Does NOT require a forge token.
 * Use for settings, profile, invite management, etc.
 */
export async function requireAuth(): Promise<AuthContext> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return {
    userId: session.user.id,
    username: session.forgeUsername ?? "",
    forgeToken: session.forgeToken ?? "",
    forgeType: session.forgeType ?? "github",
    isAdmin: session.isAdmin,
  };
}

import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { and, eq } from "drizzle-orm";
import { encryptToken, decryptTokenSafe } from "@coding-agents/shared/lib/encryption";
import { getDb } from "@/lib/db";
import {
  users,
  accounts,
  syncConnections,
  verificationTokens,
  orgs,
  projects,
} from "@coding-agents/db/schema";
import { credentialsProvider } from "./providers/credentials";
import { drizzleAdapterWithEncryptedForgeTokens } from "./drizzle-adapter-with-encrypted-tokens";

declare module "next-auth" {
  interface Session {
    forgeToken: string;
    forgeUsername: string;
    forgeType: "github" | "gitlab";
    isAdmin: boolean;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }

  interface User {
    externalProviderId?: number | null;
    externalUsername?: string | null;
    isAdmin?: boolean;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    forgeToken?: string;
    forgeUsername?: string;
    forgeType?: "github" | "gitlab";
    isAdmin?: boolean;
  }
}

/**
 * Load forge token from sync_connections for a user.
 */
async function loadForgeAccessTokenForUser(
  userId: string,
): Promise<{ token: string; forgeType: "github" | "gitlab"; username?: string } | undefined> {
  const db = getDb();

  const [conn] = await db
    .select({ accessToken: syncConnections.accessToken, remoteUsername: syncConnections.remoteUsername })
    .from(syncConnections)
    .where(and(eq(syncConnections.userId, userId), eq(syncConnections.provider, "github")))
    .limit(1);

  if (conn?.accessToken) {
    const token = decryptTokenSafe(conn.accessToken);
    if (token) {
      return { token, forgeType: "github", username: conn.remoteUsername ?? undefined };
    }
  }

  return undefined;
}

/**
 * Upsert a sync_connections row for GitHub so the agent/gateway can
 * resolve the user's token. Called from the GitHub connect OAuth flow.
 */
export async function ensureSyncConnection(
  userId: string,
  provider: "github" | "gitlab" | "bitbucket",
  accessToken: string,
  username: string,
): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: syncConnections.id })
    .from(syncConnections)
    .where(and(eq(syncConnections.userId, userId), eq(syncConnections.provider, provider)))
    .limit(1);

  const encryptedAccess = encryptToken(accessToken);

  if (existing) {
    await db
      .update(syncConnections)
      .set({ accessToken: encryptedAccess, remoteUsername: username || null })
      .where(eq(syncConnections.id, existing.id));
  } else {
    await db.insert(syncConnections).values({
      id: crypto.randomUUID(),
      userId,
      provider,
      accessToken: encryptedAccess,
      refreshToken: null,
      expiresAt: null,
      remoteUsername: username || null,
    });
  }
}

const config: NextAuthConfig = {
  adapter: drizzleAdapterWithEncryptedForgeTokens(
    DrizzleAdapter(getDb(), {
      usersTable: users,
      accountsTable: accounts,
      verificationTokensTable: verificationTokens,
    }),
  ),

  session: { strategy: "jwt" },

  providers: [credentialsProvider],

  pages: {
    signIn: "/",
    error: "/",
  },

  trustHost: true,

  events: {
    async createUser({ user }) {
      if (!user.id) return;
      try {
        const db = getDb();
        const [org] = await db.select().from(orgs).limit(1);
        if (org) {
          await db.update(users).set({ orgId: org.id }).where(eq(users.id, user.id));
          await db.insert(projects).values({
            id: crypto.randomUUID(),
            orgId: org.id,
            name: "Scratch",
            slug: `scratch-${user.id}`,
            isScratch: true,
            createdBy: user.id,
          }).onConflictDoNothing();
        }
      } catch (err) {
        console.warn("[auth] failed to assign org/scratch to new user:", err);
      }
    },
  },

  callbacks: {
    async jwt({ token, user }) {
      // Always load on sign-in. Also re-load when forgeToken is absent so that
      // connecting GitHub after sign-in is reflected on the next request without
      // requiring the user to sign out and back in.
      const userId = user?.id ?? token.sub;
      if (userId && (user?.id || !token.forgeToken)) {
        const forgeInfo = await loadForgeAccessTokenForUser(userId);
        token.forgeToken = forgeInfo?.token ?? token.forgeToken;
        token.forgeType = forgeInfo?.forgeType ?? token.forgeType ?? "github";
        token.forgeUsername =
          forgeInfo?.username ??
          token.forgeUsername ??
          user?.externalUsername ??
          user?.name ??
          undefined;
        if (user?.id) {
          token.isAdmin = user.isAdmin ?? false;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      session.forgeToken = token.forgeToken ?? "";
      session.forgeUsername = token.forgeUsername ?? "";
      session.forgeType = token.forgeType ?? "github";
      session.isAdmin = token.isAdmin ?? false;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);

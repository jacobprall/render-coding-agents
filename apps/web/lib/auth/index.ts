import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import GitHub from "next-auth/providers/github";
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
 * Resolve a forge access token for the user by checking providers in order:
 * github first, then forgejo, then gitlab.
 * Optionally prefer a specific provider (e.g. the one used for sign-in).
 */
async function loadForgeAccessTokenForUser(
  userId: string,
  preferProvider?: string,
): Promise<{ token: string; forgeType: "github" | "gitlab"; username?: string } | undefined> {
  const db = getDb();

  const defaultOrder: Array<"github" | "gitlab"> = ["github", "gitlab"];
  const providerOrder = preferProvider && (preferProvider === "github" || preferProvider === "gitlab")
    ? [preferProvider, ...defaultOrder.filter((p) => p !== preferProvider)]
    : defaultOrder;

  for (const provider of providerOrder) {
    const [row] = await db
      .select({ accessToken: accounts.access_token, providerAccountId: accounts.providerAccountId })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.provider, provider)))
      .limit(1);
    if (row?.accessToken) {
      return {
        token: decryptTokenSafe(row.accessToken),
        forgeType: provider,
        username: row.providerAccountId,
      };
    }
  }

  for (const provider of providerOrder) {
    const [conn] = await db
      .select({ accessToken: syncConnections.accessToken, remoteUsername: syncConnections.remoteUsername })
      .from(syncConnections)
      .where(and(eq(syncConnections.userId, userId), eq(syncConnections.provider, provider)))
      .limit(1);
    if (conn?.accessToken) {
      return {
        token: decryptTokenSafe(conn.accessToken),
        forgeType: provider,
        username: conn.remoteUsername ?? undefined,
      };
    }
  }

  return undefined;
}

/**
 * When a user signs in via GitHub OAuth, ensure a syncConnections row exists
 * so the agent can resolve their token for GitHub-direct sessions.
 */
async function ensureSyncConnection(
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

const githubProvider = GitHub({
  clientId: process.env.GITHUB_OAUTH_CLIENT_ID,
  clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
  authorization: { params: { scope: "read:user user:email repo" } },
  allowDangerousEmailAccountLinking: true,
});

const providers: NextAuthConfig["providers"] = [credentialsProvider];
if (process.env.GITHUB_OAUTH_CLIENT_ID) {
  providers.push(githubProvider);
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

  providers,

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
    async jwt({ token, user, account, profile }) {
      if (user?.id) {
        // When signing in via OAuth, prefer that provider's token
        const signInProvider = account?.provider;
        const forgeInfo = await loadForgeAccessTokenForUser(user.id, signInProvider);
        token.forgeToken = forgeInfo?.token;
        token.forgeType = forgeInfo?.forgeType ?? "github";
        token.isAdmin = user.isAdmin ?? false;

        const ghLogin = (profile as { login?: string } | undefined)?.login;
        token.forgeUsername = ghLogin ?? user.externalUsername ?? user.name ?? undefined;

        if (account?.provider === "github" && account.access_token) {
          // Use the fresh OAuth token directly -- it's newer than whatever was in the DB
          token.forgeToken = account.access_token;
          token.forgeType = "github";

          await ensureSyncConnection(
            user.id,
            "github",
            account.access_token,
            token.forgeUsername ?? "",
          ).catch(() => {});
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

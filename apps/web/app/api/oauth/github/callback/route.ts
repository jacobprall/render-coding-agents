import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { syncConnections } from "@openforge/db";
import { encryptToken } from "@openforge/shared/lib/encryption";
import { getSession } from "@/lib/auth/session";

async function githubToken(code: string, redirect_uri: string) {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const secret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("OAuth not configured");

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: secret,
      code,
      redirect_uri,
    }),
  });

  const tokenJson = (await tokenRes.json()) as { access_token?: string; error_description?: string };
  if (!tokenJson.access_token) {
    throw new Error(tokenJson.error_description ?? "No access_token from GitHub");
  }

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
    },
  });
  const ghUser = (await userRes.json()) as { login?: string };

  return {
    token: tokenJson.access_token,
    username: ghUser.login ?? "",
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const stateParam = url.searchParams.get("state") ?? "";

  const session = await getSession();
  if (!session) {
    redirect("/?error=github_oauth_unauthorized");
  }

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("gh_oauth_state")?.value ?? "";
  if (!code || !stateParam || stateParam !== stateCookie) {
    redirect("/settings/connections?error=github_invalid_state");
  }

  cookieStore.delete("gh_oauth_state");

  const nextBase = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const redirectUri = nextBase
    ? `${nextBase.replace(/\/$/, "")}/api/oauth/github/callback`
    : new URL("/api/oauth/github/callback", req.url).toString();

  const oauthResult = await githubToken(code, redirectUri).catch(() => undefined);
  if (oauthResult === undefined) {
    redirect("/settings/connections?error=github_token_exchange_failed");
  }

  const { token: accessToken, username: ghLogin } = oauthResult;
  const storedAccessToken = encryptToken(accessToken);

  const db = getDb();
  const userId = String(session.userId);
  const [existing] = await db
    .select({ id: syncConnections.id })
    .from(syncConnections)
    .where(and(eq(syncConnections.userId, userId), eq(syncConnections.provider, "github")))
    .limit(1);

  if (existing) {
    await db
      .update(syncConnections)
      .set({
        accessToken: storedAccessToken,
        remoteUsername: ghLogin || null,
      })
      .where(eq(syncConnections.id, existing.id));
  } else {
    await db.insert(syncConnections).values({
      id: crypto.randomUUID(),
      userId,
      provider: "github",
      accessToken: storedAccessToken,
      refreshToken: null,
      expiresAt: null,
      remoteUsername: ghLogin || null,
    });
  }

  redirect("/settings/connections");
}

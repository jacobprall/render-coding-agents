import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { syncConnections } from "@openforge/db";
import { encryptToken } from "@openforge/shared/lib/encryption";
import { getSession } from "@/lib/auth/session";

const gitlabUrl = (process.env.GITLAB_URL || "https://gitlab.com").replace(/\/$/, "");

async function gitlabToken(code: string, redirectUri: string) {
  const applicationId = process.env.GITLAB_APPLICATION_ID;
  const secret = process.env.GITLAB_APPLICATION_SECRET;
  if (!applicationId || !secret) throw new Error("GitLab OAuth not configured");

  const tokenRes = await fetch(`${gitlabUrl}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: applicationId,
      client_secret: secret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };

  if (!tokenJson.access_token) {
    throw new Error(tokenJson.error_description ?? "No access_token from GitLab");
  }

  const userRes = await fetch(`${gitlabUrl}/api/v4/user`, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  const glUser = (await userRes.json()) as { username?: string };

  return {
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token ?? null,
    expiresIn: tokenJson.expires_in ?? null,
    username: glUser.username ?? "",
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const stateParam = url.searchParams.get("state") ?? "";

  const session = await getSession();
  if (!session) {
    redirect("/?error=gitlab_oauth_unauthorized");
  }

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("gl_oauth_state")?.value ?? "";
  if (!code || !stateParam || stateParam !== stateCookie) {
    redirect("/settings/connections?error=gitlab_invalid_state");
  }

  cookieStore.delete("gl_oauth_state");

  const nextBase = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const redirectUri = nextBase
    ? `${nextBase.replace(/\/$/, "")}/api/oauth/gitlab/callback`
    : new URL("/api/oauth/gitlab/callback", req.url).toString();

  const oauthResult = await gitlabToken(code, redirectUri).catch(() => undefined);
  if (oauthResult === undefined) {
    redirect("/settings/connections?error=gitlab_token_exchange_failed");
  }

  const { accessToken, refreshToken, expiresIn, username } = oauthResult;
  const storedAccessToken = encryptToken(accessToken);

  const db = getDb();
  const userId = String(session.userId);
  const [existing] = await db
    .select({ id: syncConnections.id })
    .from(syncConnections)
    .where(and(eq(syncConnections.userId, userId), eq(syncConnections.provider, "gitlab")))
    .limit(1);

  if (existing) {
    await db
      .update(syncConnections)
      .set({
        accessToken: storedAccessToken,
        refreshToken,
        expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        remoteUsername: username || null,
      })
      .where(eq(syncConnections.id, existing.id));
  } else {
    await db.insert(syncConnections).values({
      id: crypto.randomUUID(),
      userId,
      provider: "gitlab",
      accessToken: storedAccessToken,
      refreshToken,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      remoteUsername: username || null,
    });
  }

  redirect("/settings/connections");
}

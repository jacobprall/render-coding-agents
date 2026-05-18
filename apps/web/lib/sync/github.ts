import { eq } from "drizzle-orm";
import { syncConnections } from "@openforge/db";
import { encryptToken, decryptTokenSafe } from "@openforge/shared/lib/encryption";
import type { ForgeDb } from "@/lib/db";

export async function refreshGitHubToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
} | null> {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const secret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !secret || !refreshToken) return null;

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: secret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const j = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!j.access_token) return null;
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000) : null,
  };
}

export async function getValidGitHubToken(
  db: ForgeDb,
  connectionId: string,
): Promise<string | null> {
  const [conn] = await db
    .select()
    .from(syncConnections)
    .where(eq(syncConnections.id, connectionId))
    .limit(1);

  if (!conn) return null;

  const bufferMs = 5 * 60 * 1000;
  if (!conn.expiresAt || conn.expiresAt.getTime() > Date.now() + bufferMs) {
    return decryptTokenSafe(conn.accessToken);
  }

  if (!conn.refreshToken) return null;

  const refreshed = await refreshGitHubToken(conn.refreshToken);
  if (!refreshed) return null;

  await db
    .update(syncConnections)
    .set({
      accessToken: encryptToken(refreshed.accessToken),
      refreshToken: refreshed.refreshToken,
      expiresAt: refreshed.expiresAt,
    })
    .where(eq(syncConnections.id, connectionId));

  return refreshed.accessToken;
}

export async function listGitHubRepos(
  token: string,
): Promise<
  Array<{
    full_name: string;
    name: string;
    owner: string;
    private: boolean;
    default_branch: string;
    description: string | null;
    clone_url: string;
  }>
> {
  const repos: Array<{
    full_name: string;
    name: string;
    owner: string;
    private: boolean;
    default_branch: string;
    description: string | null;
    clone_url: string;
  }> = [];

  let page = 1;
  const perPage = 100;

  while (true) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=${perPage}&page=${page}&sort=updated`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );

    if (!res.ok) break;

    const items = (await res.json()) as Array<{
      full_name: string;
      name: string;
      owner: { login: string };
      private: boolean;
      default_branch: string;
      description: string | null;
      clone_url: string;
    }>;

    if (items.length === 0) break;

    for (const r of items) {
      repos.push({
        full_name: r.full_name,
        name: r.name,
        owner: r.owner.login,
        private: r.private,
        default_branch: r.default_branch,
        description: r.description,
        clone_url: r.clone_url,
      });
    }

    if (items.length < perPage) break;
    page++;
  }

  return repos;
}

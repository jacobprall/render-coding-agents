import { eq } from "drizzle-orm";
import { syncConnections } from "@openforge/db";
import { encryptToken, decryptTokenSafe } from "@openforge/shared/lib/encryption";
import type { ForgeDb } from "@/lib/db";

const defaultGitlabUrl = "https://gitlab.com";

function resolveGitlabUrl(gitlabUrl?: string): string {
  return (gitlabUrl || process.env.GITLAB_URL || defaultGitlabUrl).replace(/\/$/, "");
}

export async function refreshGitLabToken(
  refreshToken: string,
  gitlabUrl?: string,
): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
} | null> {
  const applicationId = process.env.GITLAB_APPLICATION_ID;
  const secret = process.env.GITLAB_APPLICATION_SECRET;
  if (!applicationId || !secret || !refreshToken) return null;

  const base = resolveGitlabUrl(gitlabUrl);
  const res = await fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: applicationId,
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

export async function getValidGitLabToken(
  db: ForgeDb,
  connectionId: string,
  gitlabUrl?: string,
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

  const refreshed = await refreshGitLabToken(conn.refreshToken, gitlabUrl);
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

export async function listGitLabRepos(
  token: string,
  gitlabUrl?: string,
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
  const base = resolveGitlabUrl(gitlabUrl);
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
      `${base}/api/v4/projects?membership=true&per_page=${perPage}&page=${page}&order_by=updated_at`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!res.ok) break;

    const items = (await res.json()) as Array<{
      path_with_namespace: string;
      name: string;
      namespace: { full_path: string };
      visibility: string;
      default_branch: string;
      description: string | null;
      http_url_to_repo: string;
    }>;

    if (items.length === 0) break;

    for (const r of items) {
      repos.push({
        full_name: r.path_with_namespace,
        name: r.name,
        owner: r.namespace.full_path,
        private: r.visibility !== "public",
        default_branch: r.default_branch,
        description: r.description,
        clone_url: r.http_url_to_repo,
      });
    }

    if (items.length < perPage) break;
    page++;
  }

  return repos;
}

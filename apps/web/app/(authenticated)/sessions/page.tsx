import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { sessions, projects, syncConnections } from "@coding-agents/db";
import { and, eq, ne, desc, inArray } from "drizzle-orm";
import { getUserPreferences } from "@/lib/db/loaders";
import { decryptTokenSafe } from "@coding-agents/shared/lib/encryption";
import { createForgeProvider } from "@coding-agents/platform/forge";
import { SessionsHome } from "./sessions-home";

export const metadata: Metadata = { title: "Sessions" };

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; branch?: string; project?: string; status?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (!session) redirect("/");

  const db = getDb();
  const userId = String(session.userId);

  const [prefsRow, userSessions, reposResult] = await Promise.all([
    getUserPreferences(userId),
    db
      .select({
        id: sessions.id,
        title: sessions.title,
        status: sessions.status,
        repoPath: sessions.repoPath,
        branch: sessions.branch,
        projectId: sessions.projectId,
        lastActivityAt: sessions.lastActivityAt,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(
        params.status === "archived"
          ? and(eq(sessions.userId, userId), eq(sessions.status, "archived"))
          : and(eq(sessions.userId, userId), ne(sessions.status, "archived")),
      )
      .orderBy(desc(sessions.createdAt)),
    (async () => {
      try {
        const conns = await db
          .select({ provider: syncConnections.provider, accessToken: syncConnections.accessToken })
          .from(syncConnections)
          .where(eq(syncConnections.userId, userId));
        const allRepos: Array<{ id: string | number; name: string; fullName: string; defaultBranch: string; isPrivate?: boolean }> = [];
        for (const conn of conns) {
          const token = decryptTokenSafe(conn.accessToken);
          if (!token) continue;
          const forge = createForgeProvider({ token });
          const repos = await forge.repos.list();
          allRepos.push(...repos);
        }
        return { repos: allRepos };
      } catch {
        return { repos: [] };
      }
    })(),
  ]);

  const projectIds = [...new Set(userSessions.map((s) => s.projectId).filter(Boolean))] as string[];
  const projectRows = projectIds.length > 0
    ? await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(inArray(projects.id, projectIds))
    : [];
  const projectNames: Record<string, string> = {};
  for (const p of projectRows) {
    projectNames[p.id] = p.name;
  }

  const defaultModelId = prefsRow?.data?.defaultModelId ?? undefined;

  return (
    <SessionsHome
      sessions={userSessions}
      projectNames={projectNames}
      initialProjectFilter={params.project}
      initialStatusFilter={params.status}
      defaultModelId={defaultModelId}
      defaultRepo={params.repo}
      defaultBranch={params.branch}
      initialRepos={reposResult.repos ?? []}
      hasForgeToken={!!session.forgeToken}
    />
  );
}

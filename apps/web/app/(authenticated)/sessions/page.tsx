import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { sessions, projects } from "@coding-agents/db";
import { eq, desc, inArray } from "drizzle-orm";
import { SessionsList } from "./sessions-list";

export const metadata: Metadata = { title: "Sessions" };

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; status?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (!session) redirect("/");

  const db = getDb();
  const userId = String(session.userId);

  const userSessions = await db
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
    .where(eq(sessions.userId, userId))
    .orderBy(desc(sessions.createdAt));

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

  return (
    <SessionsList
      sessions={userSessions}
      projectNames={projectNames}
      initialProjectFilter={params.project}
      initialStatusFilter={params.status}
    />
  );
}

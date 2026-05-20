import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { sessions } from "@coding-agents/db";
import { eq, desc } from "drizzle-orm";
import { getUserPreferences } from "@/lib/db/loaders";
import { gatewayFetch } from "@/lib/gateway";
import { NewChatView } from "./new-chat-view";

export const metadata: Metadata = { title: "New Chat" };

export default async function NewSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string; branch?: string; project?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  if (!session) redirect("/");

  const userId = String(session.userId);
  const db = getDb();

  const [prefsRow, recentSessions, reposResult] = await Promise.all([
    getUserPreferences(userId),
    db
      .select({
        id: sessions.id,
        title: sessions.title,
        status: sessions.status,
        repoPath: sessions.repoPath,
        createdAt: sessions.createdAt,
      })
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(desc(sessions.createdAt))
      .limit(5),
    gatewayFetch("/sessions/repos", { userId })
      .then((r) => (r.ok ? r.json() : { repos: [] }))
      .catch(() => ({ repos: [] })),
  ]);

  const defaultModelId = prefsRow?.data?.defaultModelId ?? undefined;

  return (
    <NewChatView
      defaultModelId={defaultModelId}
      defaultRepo={params.repo}
      defaultBranch={params.branch}
      projectId={params.project}
      recentSessions={recentSessions}
      initialRepos={reposResult.repos ?? []}
      hasForgeToken={!!session.forgeToken}
    />
  );
}

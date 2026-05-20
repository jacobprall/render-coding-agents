import type { Metadata } from "next";
import { getSession } from "@/lib/auth/session";
import { redirect, notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { sessions, chats, chatMessages, userPreferences } from "@coding-agents/db";
import { eq, and, desc } from "drizzle-orm";
import { SessionWorkspace } from "@/components/session/session-workspace";
import { DEFAULT_MODEL_ID } from "@/lib/model-defaults";
import type { AssistantPart } from "@/lib/ui";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const [{ id }, userSession] = await Promise.all([params, getSession()]);
  if (!userSession) return { title: "Session" };

  const db = getDb();
  const [row] = await db
    .select({ title: sessions.title })
    .from(sessions)
    .where(and(eq(sessions.id, id), eq(sessions.userId, String(userSession.userId))))
    .limit(1);

  return { title: row?.title ?? "Session" };
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, userSession] = await Promise.all([params, getSession()]);
  if (!userSession) redirect("/");

  const db = getDb();
  const userId = String(userSession.userId);

  const [sessionRow, chatRow, prefsRow] = await Promise.all([
    db
      .select({
        id: sessions.id,
        title: sessions.title,
        repoPath: sessions.repoPath,
        branch: sessions.branch,
        activeSkills: sessions.activeSkills,
        status: sessions.status,
        prNumber: sessions.prNumber,
        prStatus: sessions.prStatus,
        upstreamPrUrl: sessions.upstreamPrUrl,
        linesAdded: sessions.linesAdded,
        linesRemoved: sessions.linesRemoved,
      })
      .from(sessions)
      .where(and(eq(sessions.id, id), eq(sessions.userId, userId)))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({
        id: chats.id,
        modelId: chats.modelId,
        activeRunId: chats.activeRunId,
      })
      .from(chats)
      .where(eq(chats.sessionId, id))
      .orderBy(desc(chats.createdAt))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1)
      .then((r) => r[0]),
  ]);

  if (!sessionRow) notFound();

  const initialModelId =
    chatRow?.modelId?.trim() ||
    prefsRow?.data?.defaultModelId?.trim() ||
    DEFAULT_MODEL_ID;

  const messages = chatRow
    ? await db
        .select({
          id: chatMessages.id,
          role: chatMessages.role,
          parts: chatMessages.parts,
          createdAt: chatMessages.createdAt,
        })
        .from(chatMessages)
        .where(eq(chatMessages.chatId, chatRow.id))
        .orderBy(chatMessages.createdAt)
    : [];

  return (
    <SessionWorkspace
      initialModelId={initialModelId}
      session={{
        id: sessionRow.id,
        title: sessionRow.title,
        repoPath: sessionRow.repoPath,
        branch: sessionRow.branch,
        activeSkills: (sessionRow.activeSkills ?? []) as Array<{ source: string; slug: string }>,
        status: sessionRow.status,
        prNumber: sessionRow.prNumber,
        prStatus: sessionRow.prStatus ?? null,
        upstreamPrUrl: sessionRow.upstreamPrUrl ?? null,
        linesAdded: sessionRow.linesAdded,
        linesRemoved: sessionRow.linesRemoved,
      }}
      activeRunId={chatRow?.activeRunId ?? null}
      initialMessages={messages.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        parts: m.parts as AssistantPart[],
        createdAt: m.createdAt.toISOString(),
      }))}
    />
  );
}

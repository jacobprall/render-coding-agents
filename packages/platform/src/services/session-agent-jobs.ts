import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { agentRuns, chatMessages, chats, sessions, syncConnections } from "@coding-agents/db";
import type { PlatformDb } from "../interfaces/database";
import type { QueueAdapter } from "../interfaces/queue";
import { getDefaultForgeProvider, getForgeProviderForAuth } from "../forge/factory";
import type { ForgeProvider, ForgeProviderType } from "../forge/provider";
import { resolveSkillsForSession } from "./session-skills";
import { decryptTokenSafe } from "../auth/encryption";

/**
 * Forge token / provider resolution for sessions (GitHub/GitLab OAuth).
 */
export async function getForgeProviderForSession(
  db: PlatformDb,
  session: { forgeType: string | null; userId: string },
): Promise<ForgeProvider> {
  const forgeType = (session.forgeType ?? "github") as ForgeProviderType;
  const [conn] = await db
    .select({ accessToken: syncConnections.accessToken })
    .from(syncConnections)
    .where(and(eq(syncConnections.userId, session.userId), eq(syncConnections.provider, forgeType)))
    .limit(1);
  if (conn?.accessToken) {
    return getForgeProviderForAuth({ forgeToken: decryptTokenSafe(conn.accessToken), forgeType });
  }
  return getDefaultForgeProvider(process.env.GITHUB_TOKEN ?? "");
}

// ---------------------------------------------------------------------------
// Shared constants & types
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL_ID = "anthropic/claude-sonnet-4-5";

export type AgentTrigger =
  | "user_message"
  | "ci_failure"
  | "review_comment"
  | "pr_opened"
  | "pr_merged"
  | "workflow_run"
  | "deploy_failure";

// ---------------------------------------------------------------------------
// collectModelMessages
// ---------------------------------------------------------------------------

/**
 * Collect model-level messages from chat rows for context continuity.
 * Returns undefined if any assistant row lacks modelMessages (graceful degradation).
 */
export function collectModelMessages(
  rows: Array<{ role: string; parts: unknown; modelMessages: unknown }>,
): unknown[] | undefined {
  const out: unknown[] = [];
  for (const row of rows) {
    if (row.role === "user") {
      const parts = row.parts as Array<{ type: string; text?: string }>;
      out.push({ role: "user", content: parts?.[0]?.text ?? JSON.stringify(parts) });
      continue;
    }
    const sdkMsgs = row.modelMessages as unknown[] | null;
    if (sdkMsgs && Array.isArray(sdkMsgs) && sdkMsgs.length > 0) {
      out.push(...sdkMsgs);
    } else {
      return undefined;
    }
  }
  if (out.length === 0) return undefined;
  return out;
}

// ---------------------------------------------------------------------------
// getOrCreateChatId
// ---------------------------------------------------------------------------

/** Get or create the most recent chat row for a session, returning its id. */
export async function getOrCreateChatId(
  db: PlatformDb,
  sessionId: string,
  title: string,
): Promise<string> {
  const [existing] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.sessionId, sessionId))
    .orderBy(desc(chats.createdAt))
    .limit(1);
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await db.insert(chats).values({ id, sessionId, title });
  return id;
}

// ---------------------------------------------------------------------------
// startAgentJob
// ---------------------------------------------------------------------------

/**
 * Create an agent run, set it as the chat's active run, and enqueue the job.
 * Used by spec approve/reject to re-launch the agent with synthetic context.
 */
export async function startAgentJob(
  db: PlatformDb,
  queue: QueueAdapter,
  params: {
    sessionRow: typeof sessions.$inferSelect;
    chatId: string;
    authUserId: string;
    authUsername: string;
    forgeToken: string;
    projectConfigPatch?: Record<string, unknown>;
    fixContext?: string;
  },
): Promise<string> {
  const { sessionRow, chatId, authUserId, authUsername, forgeToken, projectConfigPatch, fixContext } =
    params;

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(asc(chatMessages.createdAt));

  const messages = rows.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.parts,
  }));

  const modelMessages = collectModelMessages(rows);
  const runId = crypto.randomUUID();
  const requestId = crypto.randomUUID();

  const baseConfig =
    typeof sessionRow.projectConfig === "object" && sessionRow.projectConfig !== null
      ? ({ ...(sessionRow.projectConfig as object) } as Record<string, unknown>)
      : {};
  Object.assign(baseConfig, projectConfigPatch ?? {});

  const sessionForResolve = {
    ...sessionRow,
    projectConfig: Object.keys(baseConfig).length ? baseConfig : sessionRow.projectConfig,
  };
  const forge = getForgeProviderForAuth({
    forgeToken,
    forgeType: (sessionRow.forgeType ?? "github") as ForgeProviderType,
  });
  const resolvedSkills = await resolveSkillsForSession(
    sessionForResolve,
    forge,
    authUsername,
  );

  await db.insert(agentRuns).values({
    id: runId,
    chatId,
    sessionId: sessionRow.id,
    userId: authUserId,
    modelId: DEFAULT_MODEL_ID,
    status: "queued",
    trigger: "user_message",
    createdAt: new Date(),
  });

  await db
    .update(chats)
    .set({ activeRunId: runId, updatedAt: new Date() })
    .where(eq(chats.id, chatId));

  await queue.ensureGroup();
  await queue.enqueue({
    runId,
    chatId,
    sessionId: sessionRow.id,
    userId: authUserId,
    messages,
    modelMessages,
    resolvedSkills,
    projectConfig: Object.keys(baseConfig).length ? baseConfig : undefined,
    projectContext: sessionRow.projectContext ?? undefined,
    modelId: DEFAULT_MODEL_ID,
    fixContext,
    requestId,
    maxRetries: 3,
    trigger: "user_message",
  });

  return runId;
}

// ---------------------------------------------------------------------------
// enqueueSessionTriggerJob
// ---------------------------------------------------------------------------

/**
 * Enqueue an agent job triggered by a non-user-message event (CI, review, etc.).
 * Mirrors the logic in apps/web/lib/agent/enqueue-session-job.ts.
 */
export async function enqueueSessionTriggerJob(
  db: PlatformDb,
  queue: QueueAdapter,
  params: {
    sessionRow: typeof sessions.$inferSelect;
    userId: string;
    chatTitle?: string;
    trigger: Exclude<AgentTrigger, "user_message">;
    fixContext: string;
    modelId?: string;
  },
): Promise<{ runId: string; chatId: string } | null> {
  const { sessionRow, userId, trigger, fixContext, modelId } = params;

  if (trigger === "ci_failure") {
    const [updated] = await db
      .update(sessions)
      .set({
        ciFixAttempts: sql`${sessions.ciFixAttempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sessions.id, sessionRow.id),
          lt(sessions.ciFixAttempts, sessions.maxCiFixAttempts),
        ),
      )
      .returning({ id: sessions.id });

    if (!updated) {
      return null;
    }
  }

  const chatId = await getOrCreateChatId(
    db,
    sessionRow.id,
    params.chatTitle ?? sessionRow.title,
  );

  await db.insert(chatMessages).values({
    id: crypto.randomUUID(),
    chatId,
    role: "user",
    parts: [{ type: "text", text: fixContext }],
  });

  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.chatId, chatId))
    .orderBy(asc(chatMessages.createdAt));

  const messages = rows.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.parts,
  }));

  const modelMsgs = collectModelMessages(rows);
  const runId = crypto.randomUUID();

  const forge = await getForgeProviderForSession(db, sessionRow);
  const resolvedSkills = await resolveSkillsForSession(
    sessionRow,
    forge,
    sessionRow.forgeUsername ?? "unknown",
  );

  const effectiveModelId = modelId ?? DEFAULT_MODEL_ID;

  await db.insert(agentRuns).values({
    id: runId,
    chatId,
    sessionId: sessionRow.id,
    userId,
    modelId: effectiveModelId,
    status: "queued",
    trigger,
    createdAt: new Date(),
  });

  await db
    .update(chats)
    .set({ activeRunId: runId, updatedAt: new Date() })
    .where(eq(chats.id, chatId));

  await db
    .update(sessions)
    .set({ lastActivityAt: new Date(), updatedAt: new Date() })
    .where(eq(sessions.id, sessionRow.id));

  await queue.ensureGroup();
  await queue.enqueue({
    runId,
    chatId,
    sessionId: sessionRow.id,
    userId,
    messages,
    modelMessages: modelMsgs,
    resolvedSkills,
    projectConfig: sessionRow.projectConfig,
    projectContext: sessionRow.projectContext ?? undefined,
    modelId: effectiveModelId,
    fixContext,
    trigger,
    maxRetries: 3,
  });

  return { runId, chatId };
}

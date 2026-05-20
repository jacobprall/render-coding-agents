import type Redis from "ioredis";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { agentRuns, chats, chatMessages, sessions } from "@coding-agents/db";
import type { PlatformDb, EventBus } from "@coding-agents/platform";
import type { LLMMessage } from "./llm";
import type { AgentJob, StreamEvent, AssistantPart } from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

const EVENT_STREAM_TTL = 86_400; // 24h

// ─── Event streaming ─────────────────────────────────────────────────────────

export async function publishEvent(events: EventBus, runId: string, event: StreamEvent, requestId?: string): Promise<void> {
  const payload = JSON.stringify({ ...event, requestId });
  await events.publish(runId, payload);
}

/** Expire the run event stream after a terminal event so keys don't accumulate. */
export async function expireRunStream(redis: Redis, runId: string): Promise<void> {
  await redis.expire(`run:${runId}:events`, EVENT_STREAM_TTL).catch(() => {});
}

// ─── Part normalization ──────────────────────────────────────────────────────

/**
 * Merge standalone tool_result parts into their corresponding tool_call parts
 * so persisted chat history matches the shape appendStreamEvent produces for
 * live streaming (tool_call with embedded result).
 */
export function mergeToolResults(parts: AssistantPart[]): AssistantPart[] {
  const toolCallMap = new Map<string, AssistantPart>();
  const merged: AssistantPart[] = [];

  for (const part of parts) {
    if (part.type === "tool_call" && typeof part.toolCallId === "string") {
      toolCallMap.set(part.toolCallId, part);
      merged.push(part);
    } else if (part.type === "tool_result" && typeof part.toolCallId === "string") {
      const tc = toolCallMap.get(part.toolCallId);
      if (tc) {
        tc.result = part.result;
      }
    } else {
      merged.push(part);
    }
  }

  return merged;
}

// ─── DB persistence ──────────────────────────────────────────────────────────

export async function persistAssistantMessage(
  db: PlatformDb,
  job: AgentJob,
  parts: AssistantPart[],
  responseMessages: LLMMessage[],
): Promise<string> {
  const id = nanoid();
  await db.insert(chatMessages).values({
    id,
    chatId: job.chatId,
    role: "assistant",
    parts: parts as unknown as Record<string, unknown>[],
    modelMessages: responseMessages as unknown as Record<string, unknown>[],
  });
  return id;
}

export async function updateRunStatus(
  db: PlatformDb,
  job: AgentJob,
  status: "completed" | "failed" | "aborted",
  usage?: { promptTokens?: number; completionTokens?: number },
): Promise<void> {
  const finishedAt = new Date();
  const [row] = await db
    .select({ startedAt: agentRuns.startedAt })
    .from(agentRuns)
    .where(eq(agentRuns.id, job.runId))
    .limit(1);
  const totalDurationMs = row?.startedAt ? finishedAt.getTime() - row.startedAt.getTime() : null;

  const updateData: Record<string, unknown> = { status, finishedAt, totalDurationMs };
  if (usage?.promptTokens != null) updateData.promptTokens = usage.promptTokens;
  if (usage?.completionTokens != null) updateData.completionTokens = usage.completionTokens;

  await db
    .update(agentRuns)
    .set(updateData)
    .where(eq(agentRuns.id, job.runId));

  await db.update(chats).set({ activeRunId: null, updatedAt: new Date() }).where(eq(chats.id, job.chatId));
  await db.update(sessions).set({ lastActivityAt: finishedAt, updatedAt: finishedAt }).where(eq(sessions.id, job.sessionId));
}

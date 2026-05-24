import type Redis from "ioredis";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { agentRuns, chats, chatMessages, sessions } from "@coding-agents/db";
import type { PlatformDb, EventBus, TerminalReason } from "@coding-agents/platform";
import type { LLMMessage } from "./llm";
import type { StreamEvent } from "@coding-agents/shared";
import type { AgentJob, AssistantPart } from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

const EVENT_STREAM_TTL = 86_400; // 24h

// ─── Event streaming ─────────────────────────────────────────────────────────

export async function publishEvent(
  events: EventBus,
  runId: string,
  event: StreamEvent,
  requestId?: string,
): Promise<void> {
  const toPublish: StreamEvent = requestId ? { ...event, requestId } : event;
  await events.publish(runId, JSON.stringify(toPublish));
}

export function evt(type: string, payload: Record<string, unknown> = {}): StreamEvent {
  return { v: 2, type, ts: new Date().toISOString(), payload };
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
  const toolCallIndices = new Map<string, number>();
  const merged: AssistantPart[] = [];

  for (const part of parts) {
    if (part.type === "tool_call" && typeof part.toolCallId === "string") {
      toolCallIndices.set(part.toolCallId, merged.length);
      merged.push({ ...part });
    } else if (part.type === "tool_result" && typeof part.toolCallId === "string") {
      const idx = toolCallIndices.get(part.toolCallId);
      if (idx !== undefined) {
        merged[idx] = { ...merged[idx], result: part.result };
      } else {
        merged.push(part);
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

export async function upsertAssistantMessage(
  db: PlatformDb,
  events: EventBus,
  job: AgentJob,
  parts: AssistantPart[],
  responseMessages: LLMMessage[],
  existingMessageId?: string,
  requestId?: string,
): Promise<string> {
  const mergedParts = mergeToolResults(parts);

  if (existingMessageId) {
    await db
      .update(chatMessages)
      .set({
        parts: mergedParts as unknown as Record<string, unknown>[],
        modelMessages: responseMessages as unknown as Record<string, unknown>[],
      })
      .where(eq(chatMessages.id, existingMessageId));

    await publishEvent(events, job.runId, evt("agent:step_persisted", {
      step: mergedParts.length,
      partCount: mergedParts.length,
      assistantMessageId: existingMessageId,
    }), requestId);

    return existingMessageId;
  }

  const id = nanoid();
  await db.insert(chatMessages).values({
    id,
    chatId: job.chatId,
    role: "assistant",
    parts: mergedParts as unknown as Record<string, unknown>[],
    modelMessages: responseMessages as unknown as Record<string, unknown>[],
    runId: job.runId,
  });

  await publishEvent(events, job.runId, evt("agent:step_persisted", {
    step: mergedParts.length,
    partCount: mergedParts.length,
    assistantMessageId: id,
  }), requestId);

  return id;
}

export async function updateRunStatus(
  db: PlatformDb,
  job: AgentJob,
  status: "completed" | "failed" | "aborted" | "error",
  usage?: { promptTokens?: number; completionTokens?: number },
  terminalReason?: TerminalReason,
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
  if (terminalReason) updateData.terminalReason = terminalReason;

  await db
    .update(agentRuns)
    .set(updateData)
    .where(eq(agentRuns.id, job.runId));

  await db.update(chats).set({ activeRunId: null, updatedAt: new Date() }).where(eq(chats.id, job.chatId));

  const sessionStatus = (status === "failed" || status === "error") ? "failed" : "completed";
  await db
    .update(sessions)
    .set({ status: sessionStatus, lastActivityAt: finishedAt, updatedAt: finishedAt })
    .where(eq(sessions.id, job.sessionId));
}

export async function updateHeartbeat(
  db: PlatformDb,
  runId: string,
): Promise<void> {
  try {
    await db
      .update(agentRuns)
      .set({ lastHeartbeatAt: new Date() })
      .where(eq(agentRuns.id, runId));
  } catch (err) {
    console.warn("[agent] Failed to update heartbeat:", err);
  }
}

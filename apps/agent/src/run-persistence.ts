import type Redis from "ioredis";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { agentRuns, chats, chatMessages, sessions } from "@coding-agents/db";
import type { PlatformDb, EventBus, TerminalReason } from "@coding-agents/platform";
import type { LLMMessage } from "./llm";
import type { StreamEventV2 } from "@coding-agents/shared";
import type { AgentJob, StreamEvent, AssistantPart } from "./types";

// ─── Constants ───────────────────────────────────────────────────────────────

const EVENT_STREAM_TTL = 86_400; // 24h

const V1_TO_V2_TYPE_MAP: Record<string, string> = {
  token: "agent:message",
  tool_call: "agent:tool_call",
  tool_result: "agent:tool_result",
  heartbeat: "agent:heartbeat",
  file_changed: "agent:file_changed",
  done: "session:completed",
  error: "session:failed",
  aborted: "session:aborted",
  ask_user: "agent:ask_user",
  task_start: "step:started",
  task_done: "step:completed",
  task_error: "step:failed",
  spec: "plan:generated",
  step_persisted: "agent:step_persisted",
  phase_changed: "session:phase_changed",
  verification: "agent:verification",
  verify_failed: "agent:verify_failed",
};

function mapEventType(v1Type: string): string {
  return V1_TO_V2_TYPE_MAP[v1Type] ?? v1Type;
}

function extractPayload(event: StreamEvent): Record<string, unknown> {
  const { type, ...rest } = event;
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  return payload;
}

// ─── Event streaming ─────────────────────────────────────────────────────────

export async function publishEvent(
  events: EventBus,
  runId: string,
  event: StreamEvent,
  requestId?: string,
): Promise<void> {
  const v2: StreamEventV2 = {
    v: 2,
    type: mapEventType(event.type),
    ts: new Date().toISOString(),
    requestId,
    payload: extractPayload(event),
  };
  await events.publish(runId, JSON.stringify(v2));
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

    await publishEvent(events, job.runId, {
      type: "step_persisted",
      step: mergedParts.length,
      partCount: mergedParts.length,
      assistantMessageId: existingMessageId,
    }, requestId);

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

  await publishEvent(events, job.runId, {
    type: "step_persisted",
    step: mergedParts.length,
    partCount: mergedParts.length,
    assistantMessageId: id,
  }, requestId);

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

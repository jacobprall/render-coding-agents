import type Redis from "ioredis";
import { AppError } from "@coding-agents/shared";
import type { PlatformDb, EventBus, TerminalReason } from "@coding-agents/platform";
import type { AgentJob, AssistantPart } from "../types";
import {
  updateRunStatus,
  publishEvent,
  evt,
  expireRunStream,
} from "../run-persistence";
import { persistSessionSummary } from "../pr-manager";

export const RUN_STATUS_TTL = 3600;

export type RunTerminalOutcome = "completed" | "aborted" | "failed";

export interface RunTerminalPrMeta {
  prUrls: string[];
  reposTouched: string[];
  linesAdded: number;
  linesRemoved: number;
}

export interface FinalizeRunTerminalParams {
  db: PlatformDb;
  events: EventBus;
  redis: Redis;
  job: AgentJob;
  outcome: RunTerminalOutcome;
  terminalReason: TerminalReason;
  assistantParts?: AssistantPart[];
  usage?: { promptTokens?: number; completionTokens?: number };
  assistantMessageId?: string;
  prMeta?: RunTerminalPrMeta;
  fileStats?: { linesAdded: number; linesRemoved: number };
  error?: unknown;
  /** Extra fields merged into session:completed payload (e.g. plan_rejected). */
  sessionCompletedExtras?: Record<string, unknown>;
}

export async function finalizeRunTerminal(params: FinalizeRunTerminalParams): Promise<void> {
  const {
    db,
    events,
    redis,
    job,
    outcome,
    terminalReason,
    assistantParts = [],
    usage,
    assistantMessageId,
    prMeta = { prUrls: [], reposTouched: [], linesAdded: 0, linesRemoved: 0 },
    fileStats,
    error,
    sessionCompletedExtras,
  } = params;

  const runStatus =
    outcome === "completed" ? "completed" : outcome === "aborted" ? "aborted" : "failed";

  console.info("[agent] run_terminal", {
    runId: job.runId,
    sessionId: job.sessionId,
    terminalReason,
    status: runStatus,
    ...(error instanceof Error ? { error: error.message } : {}),
  });

  await updateRunStatus(
    db,
    job,
    runStatus,
    outcome === "completed" ? usage : undefined,
    terminalReason,
  );

  await persistSessionSummary({
    db,
    job,
    outcome,
    assistantParts,
    ...prMeta,
    ...(fileStats ?? {}),
  });

  if (outcome === "completed") {
    await publishEvent(
      events,
      job.runId,
      evt("session:completed", {
        assistantMessageId,
        assistantParts: assistantParts as unknown[],
        terminalReason,
        ...sessionCompletedExtras,
      }),
      job.requestId,
    );
  } else if (outcome === "aborted") {
    await publishEvent(
      events,
      job.runId,
      evt("session:aborted", { terminalReason }),
      job.requestId,
    );
  } else {
    await publishEvent(
      events,
      job.runId,
      evt("session:failed", {
        message: error instanceof Error ? error.message : String(error ?? "Unknown error"),
        code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        requestId: job.requestId,
        retryable: error instanceof AppError ? error.retryable : false,
        terminalReason,
      }),
      job.requestId,
    );
  }

  await events.setKey(`run:${job.runId}:status`, runStatus, RUN_STATUS_TTL);
  await expireRunStream(redis, job.runId);
}

/** Plan rejected or approval timed out — completed run without implementation. */
export async function finalizePlanRejected(params: {
  db: PlatformDb;
  events: EventBus;
  redis: Redis;
  job: AgentJob;
  reason: string;
}): Promise<void> {
  const { db, events, redis, job, reason } = params;

  await publishEvent(events, job.runId, evt("plan:rejected", { reason }), job.requestId);
  await finalizeRunTerminal({
    db,
    events,
    redis,
    job,
    outcome: "completed",
    terminalReason: "end_turn",
    assistantParts: [],
    sessionCompletedExtras: { terminalReason: "plan_rejected", reason },
  });
}

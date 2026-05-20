import type Redis from "ioredis";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import type { ResolvedSkill } from "../skills";
import { sessions, agentRuns, chats } from "@openforge/db";
import { enqueueJob, ensureConsumerGroup, publishRunEvent } from "@openforge/platform";

export type AgentRole = "spec" | "implement" | "review" | "merge";

export interface AgentPipeline {
  roles: AgentPipelineStep[];
}

export interface AgentPipelineStep {
  role: AgentRole;
  model?: string;
  trigger: string;
  tools?: string[];
  auto?: boolean;
}

export const DEFAULT_PIPELINE: AgentPipeline = {
  roles: [
    { role: "spec", trigger: "user_message", tools: ["ask_user_question", "submit_spec"] },
    { role: "implement", trigger: "spec_approved", tools: ["bash", "read_file", "write_file", "edit_file", "glob", "grep", "git", "create_pull_request"] },
    { role: "review", trigger: "pr_opened", tools: ["pull_request_diff", "review_pr", "add_pr_comment", "approve_pr"] },
    { role: "merge", trigger: "pr_approved_and_ci_green", auto: true },
  ],
};

export function getToolsForRole(role: AgentRole, pipeline?: AgentPipeline): string[] {
  const p = pipeline ?? DEFAULT_PIPELINE;
  const step = p.roles.find(r => r.role === role);
  return step?.tools ?? [];
}

export function nextPipelineStep(currentRole: AgentRole, pipeline?: AgentPipeline): AgentPipelineStep | null {
  const p = pipeline ?? DEFAULT_PIPELINE;
  const idx = p.roles.findIndex(r => r.role === currentRole);
  if (idx === -1 || idx >= p.roles.length - 1) return null;
  return p.roles[idx + 1] ?? null;
}

// ─── Role → session status label (for UI/DB phase column) ───────────────────

const ROLE_TO_PHASE: Record<AgentRole, string> = {
  spec: "spec",
  implement: "execute",
  review: "verify",
  merge: "deliver",
};

export function roleToPhase(role: AgentRole): string {
  return ROLE_TO_PHASE[role] ?? role;
}

// ─── Session Handoff Runtime ─────────────────────────────────────────────────

export interface HandoffParams {
  sessionId: string;
  chatId: string;
  userId: string;
  fromRole: AgentRole;
  pipeline?: AgentPipeline;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  modelMessages?: unknown[];
  projectConfig?: unknown;
  projectContext?: string | null;
  requestId?: string;
  /** Skills snapshot for the handoff run (required for the job queue). */
  resolvedSkills: ResolvedSkill[];
}

export interface HandoffResult {
  handed: boolean;
  nextRole: AgentRole | null;
  newRunId: string | null;
  reason?: string;
}

/**
 * Perform a multi-agent session handoff: given a completed role, find the
 * next pipeline step and enqueue a new agent run for that role.
 *
 * Auto-steps (like merge) are dispatched without user intervention.
 * Returns a result describing what happened.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

export async function handoffToNextAgent(
  db: AnyDb,
  redis: Redis,
  params: HandoffParams,
): Promise<HandoffResult> {
  const p = params.pipeline ?? DEFAULT_PIPELINE;
  const next = nextPipelineStep(params.fromRole, p);

  if (!next) {
    return { handed: false, nextRole: null, newRunId: null, reason: "Pipeline complete — no next step" };
  }

  const newRunId = nanoid();

  await db.update(sessions).set({
    updatedAt: new Date(),
  }).where(eq(sessions.id, params.sessionId));

  await db.insert(agentRuns).values({
    id: newRunId,
    chatId: params.chatId,
    sessionId: params.sessionId,
    userId: params.userId,
    modelId: next.model ?? "default",
    status: "queued",
    createdAt: new Date(),
  });

  await db.update(chats)
    .set({ activeRunId: newRunId, updatedAt: new Date() })
    .where(eq(chats.id, params.chatId));

  await ensureConsumerGroup(redis);
  await enqueueJob(redis, {
    runId: newRunId,
    chatId: params.chatId,
    sessionId: params.sessionId,
    userId: params.userId,
    messages: params.messages,
    modelMessages: params.modelMessages,
    resolvedSkills: params.resolvedSkills,
    projectConfig: params.projectConfig,
    projectContext: params.projectContext,
    modelId: next.model,
    requestId: params.requestId,
    trigger: next.trigger,
  });

  await publishRunEvent(redis, newRunId, JSON.stringify({
    type: "handoff",
    fromRole: params.fromRole,
    toRole: next.role,
    newRunId,
    requestId: params.requestId,
  }));

  console.log(`[multi-agent] handoff: ${params.fromRole} → ${next.role} session=${params.sessionId} run=${newRunId}`);

  return { handed: true, nextRole: next.role, newRunId };
}

/**
 * Given a trigger event, find which pipeline role should handle it and
 * enqueue a run for that role. Returns null if no role matches the trigger.
 */
export function findRoleForTrigger(
  trigger: string,
  pipeline?: AgentPipeline,
): AgentPipelineStep | null {
  const p = pipeline ?? DEFAULT_PIPELINE;
  return p.roles.find(r => r.trigger === trigger) ?? null;
}

/**
 * Check whether a role is an auto-step (should execute without user input).
 */
export function isAutoStep(role: AgentRole, pipeline?: AgentPipeline): boolean {
  const p = pipeline ?? DEFAULT_PIPELINE;
  const step = p.roles.find(r => r.role === role);
  return step?.auto === true;
}

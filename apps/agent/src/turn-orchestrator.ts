import type Redis from "ioredis";
import { and, eq } from "drizzle-orm";
import { agentRuns, sessions, prEvents, projects, projectRepos } from "@coding-agents/db";
import { AppError } from "@coding-agents/shared";
import { resolveLlmApiKeys, type ResolvedLlmKeys, type PlatformContainer, type PlatformDb, type EventBus } from "@coding-agents/platform";
import type { SandboxAdapter } from "@coding-agents/sandbox";
import type { ForgeAgentContext } from "./context/agent-context";
import type { LLMMessage } from "./llm";
import { jobMessagesToLLMMessages, sanitizeMessages } from "./messages";
import { buildAgentSystemPrompt, FORGE_LABELS } from "./system-prompt";
import { listBuiltinSummaries } from "./skills";
import { getModel, getModelDef } from "./models";
import type { AgentJob, AssistantPart } from "./types";
import { isDeliverComplete, transitionToComplete } from "./lib/deliver";
import { getForgeProviderForSession, getAdapter } from "./providers";
import { buildToolSet } from "./tool-registry";
import { publishEvent, evt, mergeToolResults, upsertAssistantMessage } from "./run-persistence";
import { agentLoop } from "./loop";
import { ObservabilityRecorder } from "./observability";
import type { PlanResult } from "./planner";
import { setupWorkspace, repoNameFromPath } from "./workspace";
import { createPrsForChangedRepos } from "./pr-manager";
import { runPlanningPhaseIfNeeded } from "./lib/planning-phase";
import { startRunHeartbeat } from "./lib/run-heartbeat";
import { finalizeRunTerminal, RUN_STATUS_TTL } from "./lib/run-terminal";

const MAX_STEPS = parseInt(process.env.MAX_AGENT_STEPS ?? "100", 10);
const TURN_TIMEOUT_MS = parseInt(process.env.TURN_TIMEOUT_MS ?? String(10 * 60 * 1000), 10);
const PLANNING_ENABLED = process.env.PLANNING_ENABLED === "true";

export class AbortError extends Error {
  constructor(public readonly parts: AssistantPart[]) {
    super("ABORTED");
    this.name = "AbortError";
  }
}

export function isTimeoutAbort(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError" && !(error instanceof AbortError)) {
    return true;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return false;
}

async function isAborted(events: EventBus, runId: string): Promise<boolean> {
  const val = await events.getKey(`run:${runId}:abort`);
  return val === "1";
}

export function createMergedAbortController(
  events: EventBus,
  runId: string,
  timeoutMs: number,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("Turn timeout", "TimeoutError"));
    }
  }, timeoutMs);

  const pollInterval = setInterval(async () => {
    try {
      const val = await events.getKey(`run:${runId}:abort`);
      if (val === "1" && !controller.signal.aborted) {
        controller.abort(new DOMException("User stopped", "AbortError"));
      }
    } catch {}
  }, 500);

  const cleanup = () => {
    clearTimeout(timeout);
    clearInterval(pollInterval);
  };

  return { controller, cleanup };
}

export function buildModelMessages(job: AgentJob): LLMMessage[] {
  const raw = job.modelMessages?.length
    ? (job.modelMessages as LLMMessage[])
    : jobMessagesToLLMMessages(job.messages);
  return sanitizeMessages(raw);
}

function buildThinkingParams(job: AgentJob) {
  const modelDef = getModelDef(job.modelId);
  const isAnthropic = modelDef.provider === "anthropic";
  const thinkingType = isAnthropic ? modelDef.thinkingType : undefined;

  if (!thinkingType) return undefined;
  return thinkingType === "adaptive"
    ? { type: "adaptive" as const, budgetTokens: 16000 }
    : { type: "enabled" as const, budgetTokens: 8000 };
}

function buildSystemPromptForJob(job: AgentJob, isScratch = false): string {
  const appended = [job.fixContext].filter(Boolean).join("\n\n");

  const skillIndex = listBuiltinSummaries();

  const base = buildAgentSystemPrompt({
    skillIndex,
    projectContext: job.projectContext,
    projectConfig: job.projectConfig,
    forgeLabel: FORGE_LABELS.github,
    isScratch,
  });
  return appended ? `${base}\n\n${appended}` : base;
}

export function buildWorkspaceContext(
  sessionRow: { repoPath: string | null; branch: string | null; baseBranch: string | null; userId?: string } | undefined,
  ctx: ForgeAgentContext,
  options?: { workdir?: string; repos?: AgentJob["repos"] },
): string | null {
  if (!sessionRow) return null;

  const repos = options?.repos;
  if (!sessionRow.repoPath && !repos?.length) {
    const scratchDir = `/workspace/scratch/${sessionRow.userId ?? ctx.sessionId}`;
    return [
      "# Workspace",
      "",
      "- **Mode:** Scratch workbench (no repository attached)",
      `- **Working directory:** \`${scratchDir}\` — a persistent personal workspace. You can create files, run commands, and prototype freely here.`,
      "- To connect this work to a repository later, the user can select one and you can use git init, push, etc.",
    ].join("\n");
  }

  const workdir = options?.workdir ?? `/workspace/${ctx.sessionId}`;
  const branch = sessionRow.branch || (repos?.length ? `agent/${ctx.sessionId}` : "main");
  const baseBranch = sessionRow.baseBranch || "main";

  const lines = ["# Workspace", ""];

  if (repos && repos.length > 0) {
    lines.push("- **Mode:** Multi-repository workspace");
    lines.push("- **Repositories:**");
    for (const repo of repos) {
      const name = repoNameFromPath(repo.repoPath);
      const repoDir = `/workspace/${ctx.sessionId}/repos/${name}`;
      lines.push(`  - \`${repo.repoPath}\`${repo.isPrimary ? " (primary)" : ""} — \`${repoDir}\``);
    }
    lines.push(
      `- **Working directory:** \`${workdir}\` — primary repo. Bash and git commands run here by default.`,
      "- To work in another repo, use a single command with \`git -C repos/{name} ...\` or \`cd repos/{name} && ...\`.",
    );
  } else {
    lines.push(
      `- **Repository:** ${sessionRow.repoPath}`,
      `- **Working directory:** \`${workdir}\` — the repo is cloned here. All bash and git commands execute in this directory automatically. Do NOT \`cd\` elsewhere; \`cd\` does not persist between commands.`,
    );
  }

  lines.push(`- **Branch:** ${branch}`);
  lines.push(`- **Base branch:** ${baseBranch}`);

  if (ctx.repoOwner && ctx.repoName) {
    lines.push(`- **Owner:** ${ctx.repoOwner}`);
  }

  return lines.join("\n");
}

export function computeFileStatsFromParts(parts: AssistantPart[]): {
  linesAdded: number;
  linesRemoved: number;
} {
  const linesAdded = parts
    .filter((p) => p.type === "file_changed")
    .reduce((sum, p) => sum + (Number(p.additions) || 0), 0);
  const linesRemoved = parts
    .filter((p) => p.type === "file_changed")
    .reduce((sum, p) => sum + (Number(p.deletions) || 0), 0);
  return { linesAdded, linesRemoved };
}

interface SessionRowContext {
  repoPath: string | null;
  branch: string | null;
  baseBranch: string | null;
  title: string;
  forgeType: string | null;
  userId: string;
  projectId: string | null;
}

async function buildForgeContext(params: {
  job: AgentJob;
  db: PlatformDb;
  events: EventBus;
  adapter: SandboxAdapter;
  assistantParts: AssistantPart[];
}): Promise<{ forgeContext: ForgeAgentContext; sessionRow: SessionRowContext | undefined }> {
  const { job, db, events, adapter, assistantParts } = params;
  const reqId = job.requestId;

  // Prefer pre-fetched session context from job payload (set by sendMessage).
  // Fall back to a DB query for backward compat with already-queued jobs.
  const sessionRow: SessionRowContext | undefined = job.sessionContext
    ? { ...job.sessionContext, userId: job.userId }
    : (await db
        .select({
          repoPath: sessions.repoPath,
          branch: sessions.branch,
          baseBranch: sessions.baseBranch,
          title: sessions.title,
          forgeType: sessions.forgeType,
          userId: sessions.userId,
          projectId: sessions.projectId,
        })
        .from(sessions)
        .where(eq(sessions.id, job.sessionId))
        .limit(1))[0];

  const isScratch = !sessionRow?.repoPath && !job.repos?.length;

  const forge = await getForgeProviderForSession(db, {
    forgeType: sessionRow?.forgeType ?? "github",
    userId: sessionRow?.userId ?? job.userId,
  });

  const primaryRepoPath =
    job.repos?.find((r) => r.isPrimary)?.repoPath ??
    job.repos?.[0]?.repoPath ??
    sessionRow?.repoPath ??
    "";
  const [repoOwner, repoName] = primaryRepoPath.split("/");

  const forgeContext: ForgeAgentContext = {
    __brand: "ForgeAgentContext",
    sessionId: isScratch ? `scratch/${job.userId}` : job.sessionId,
    projectId: sessionRow?.projectId ?? null,
    adapter,
    forge,
    repoOwner: repoOwner ?? "",
    repoName: repoName ?? "",
    branch: sessionRow?.branch ?? "main",
    baseBranch: sessionRow?.baseBranch ?? "main",
    onFileChanged: async (p) => {
      await publishEvent(events, job.runId, evt("agent:file_changed", {
        path: p.path,
        additions: p.additions,
        deletions: p.deletions,
        unifiedDiffPreview: p.unifiedDiffPreview,
      }), reqId);
      assistantParts.push({ type: "file_changed", ...p });
    },
    onPrCreated: async ({ prNumber }) => {
      if (isScratch) return;
      await db
        .update(sessions)
        .set({ prNumber, prStatus: "open", updatedAt: new Date() })
        .where(eq(sessions.id, job.sessionId));

      await db.insert(prEvents).values({
        id: crypto.randomUUID(),
        userId: job.userId,
        sessionId: job.sessionId,
        repoPath: sessionRow?.repoPath ?? "",
        prNumber,
        action: "opened",
        title: sessionRow?.title ?? "PR",
        actionNeeded: true,
        metadata: { createdByAgent: true, runId: job.runId },
      });
    },
  };

  return { forgeContext, sessionRow };
}

async function buildProjectBlock(db: PlatformDb, projectId: string | null): Promise<string | null> {
  if (!projectId) return null;
  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return null;

    const lines = ["# Project", "", `- **Name:** ${project.name}`];

    if (project.instructions) {
      lines.push("", "## Project Instructions", "", project.instructions);
    }

    const repos = await db
      .select({ repoPath: projectRepos.repoPath, isPrimary: projectRepos.isPrimary })
      .from(projectRepos)
      .where(eq(projectRepos.projectId, projectId));
    if (repos.length > 0) {
      lines.push("", "## Linked Repos");
      for (const r of repos) {
        lines.push(`- ${r.repoPath}${r.isPrimary ? " (primary)" : ""}`);
      }
    }

    return lines.join("\n");
  } catch {
    return null;
  }
}

async function runTurn(params: {
  job: AgentJob;
  redis: Redis;
  events: EventBus;
  platform: PlatformContainer;
  db: PlatformDb;
  adapter: SandboxAdapter;
  llmKeys: ResolvedLlmKeys;
  workspaceSetup: { workdir: string; repoCount: number };
  approvedPlan?: PlanResult;
  setActivity: (activity: string) => void;
}): Promise<{
  text: string;
  assistantParts: AssistantPart[];
  responseMessages: LLMMessage[];
  usage: { promptTokens?: number; completionTokens?: number };
  hitStepLimit: boolean;
  terminationReason?: string;
  assistantMessageId?: string;
  forgeContext: ForgeAgentContext;
  sessionRow: SessionRowContext | undefined;
}> {
  const { job, redis, events, db, adapter, llmKeys, platform, workspaceSetup, approvedPlan, setActivity } = params;
  const { provider, modelId } = getModel(job.modelId, llmKeys);
  const thinkingParams = buildThinkingParams(job);

  const reqId = job.requestId;
  const assistantParts: AssistantPart[] = [];
  let assistantMessageId: string | undefined;
  const recorder = new ObservabilityRecorder({
    platform,
    sessionId: job.sessionId,
    runId: job.runId,
    userId: job.userId,
  });

  let cleanupAbort: (() => void) | undefined;

  try {
    const { forgeContext, sessionRow } = await buildForgeContext({ job, db, events, adapter, assistantParts });

    const isScratch = !sessionRow?.repoPath && !job.repos?.length;
    const basePrompt = buildSystemPromptForJob(job, isScratch);
    const workspaceBlock = buildWorkspaceContext(sessionRow, forgeContext, {
      workdir: workspaceSetup.workdir,
      repos: job.repos,
    });
    let systemPrompt = workspaceBlock ? `${basePrompt}\n\n${workspaceBlock}` : basePrompt;

    // Prefer pre-computed project block from job payload; fall back to DB query.
    const projectBlock = job.projectBlock ?? await buildProjectBlock(db, sessionRow?.projectId ?? null);
    if (projectBlock) {
      systemPrompt = `${systemPrompt}\n\n${projectBlock}`;
    }

    if (approvedPlan?.formattedForContext) {
      systemPrompt = `${systemPrompt}\n\n${approvedPlan.formattedForContext}`;
    }

    const resultStore = new Map<string, string>();
    const inputMessages = buildModelMessages(job);

    const redactionSecrets: Record<string, string> = { ...job.resolvedSecrets };
    if (job.resolvedEnv) {
      for (const [key, value] of Object.entries(job.resolvedEnv)) {
        if (key.startsWith("__SECRET__") && value) {
          redactionSecrets[key] = value;
        }
      }
    }

    console.log(
      `[agent] runId=${job.runId} skills=${job.resolvedSkills.map((s) => s.slug).join(",")} messages=${inputMessages.length}`,
    );

    const { controller: abortController, cleanup } = createMergedAbortController(events, job.runId, TURN_TIMEOUT_MS);
    cleanupAbort = cleanup;

    const tools = buildToolSet({
      events,
      redis,
      db,
      job,
      provider,
      modelId,
      forgeContext,
      hasRepo: !isScratch,
      resultStore,
      llmKeys,
      signal: abortController.signal,
      recorder,
      secrets: redactionSecrets,
    });

    const result = await agentLoop({
      provider,
      model: modelId,
      system: systemPrompt,
      messages: inputMessages,
      tools,
      maxSteps: MAX_STEPS,
      signal: abortController.signal,
      thinking: thinkingParams,
      resultStore,
      recorder,
      secrets: redactionSecrets,
      shouldAbort: async () => {
        if (await isAborted(events, job.runId)) {
          throw new AbortError(assistantParts);
        }
        return false;
      },
      onSteeringCheck: async () => {
        const queued = await events.consumeSteering(job.runId);
        if (queued.length > 0) {
          console.info(`[agent][${job.runId}] consumed ${queued.length} steering event(s)`, { types: queued.map((e) => e.type) });
        }
        return { messages: queued };
      },
      onToken: (token) => {
        setActivity("llm_call");
        publishEvent(events, job.runId, evt("agent:message", { content: token }), reqId).catch((err) => {
          console.warn("[agent] Failed to publish token event:", err);
        });
      },
      onStep: async ({ text, toolCalls, toolResults }) => {
        setActivity("tool_execution");

        if (text) {
          assistantParts.push({ type: "text", text });
        }

        for (const tc of toolCalls) {
          assistantParts.push({ type: "tool_call", toolName: tc.toolName, toolCallId: tc.toolCallId, args: tc.input });
          await publishEvent(events, job.runId, evt("agent:tool_call", { toolName: tc.toolName, toolCallId: tc.toolCallId, args: tc.input }), reqId);
        }

        for (const tr of toolResults) {
          assistantParts.push({ type: "tool_result", toolCallId: tr.toolCallId, result: tr.output });
          await publishEvent(events, job.runId, evt("agent:tool_result", { toolCallId: tr.toolCallId, result: tr.output }), reqId);
        }

        try {
          assistantMessageId = await upsertAssistantMessage(
            db, events, job, assistantParts, [], assistantMessageId, reqId
          );
        } catch (err) {
          console.warn("[agent] Incremental persist failed:", err);
        }
      },
    });

    if (result.hitStepLimit) {
      const limitMsg = `Reached the maximum step limit (${MAX_STEPS}). Send another message to continue where I left off.`;
      assistantParts.push({ type: "text", text: limitMsg });
      await publishEvent(events, job.runId, evt("agent:message", { content: limitMsg }), reqId);
    }

    return {
      text: result.text,
      assistantParts: mergeToolResults(assistantParts),
      responseMessages: result.messages,
      usage: {
        promptTokens: result.totalUsage.inputTokens,
        completionTokens: result.totalUsage.outputTokens,
      },
      hitStepLimit: result.hitStepLimit,
      terminationReason: result.terminationReason,
      assistantMessageId,
      forgeContext,
      sessionRow,
    };
  } finally {
    cleanupAbort?.();
    await recorder.close();
  }
}

export async function runAgentTurn(job: AgentJob, redis: Redis, platform: PlatformContainer): Promise<void> {
  const { db, events } = platform;

  const claimed = await db
    .update(agentRuns)
    .set({ status: "running", startedAt: new Date(), lastHeartbeatAt: new Date() })
    .where(and(eq(agentRuns.id, job.runId), eq(agentRuns.status, "queued")))
    .returning({ id: agentRuns.id });

  if (claimed.length === 0) {
    const [existingRun] = await db
      .select({ status: agentRuns.status })
      .from(agentRuns)
      .where(eq(agentRuns.id, job.runId))
      .limit(1);
    console.info(`[agent] Skipping run ${job.runId} (status=${existingRun?.status ?? "unknown"})`);
    return;
  }

  await events.setKey(`run:${job.runId}:status`, "running", RUN_STATUS_TTL);

  let currentActivity = "idle";
  const stopRunHeartbeat = startRunHeartbeat({
    db,
    runId: job.runId,
    events,
    reqId: job.requestId,
    getActivity: () => currentActivity,
  });

  let adapter: SandboxAdapter | undefined;
  let approvedPlan: PlanResult | undefined;
  let summaryParts: AssistantPart[] = [];
  let prMeta = { prUrls: [] as string[], reposTouched: [] as string[], linesAdded: 0, linesRemoved: 0 };

  try {
    // Parallelize adapter init and LLM key resolution — they're independent.
    const [resolvedAdapter, llmKeys] = await Promise.all([
      getAdapter(job.sessionId),
      resolveLlmApiKeys(db, job.userId),
    ]);
    adapter = resolvedAdapter;

    const setupStart = Date.now();
    const workspaceSetup = await setupWorkspace({ job, db, adapter, events });
    console.info(`[agent][${job.runId}] workspace setup complete`, { durationMs: Date.now() - setupStart, ...workspaceSetup });

    const isContinuation = (job.modelMessages?.length ?? 0) > 0;
    const planning = await runPlanningPhaseIfNeeded({
      job,
      redis,
      events,
      db,
      adapter,
      enabled: PLANNING_ENABLED,
      isContinuation,
    });
    if (planning.status === "rejected") {
      return;
    }
    if (planning.status === "approved") {
      approvedPlan = planning.plan;
    }

    const {
      assistantParts,
      responseMessages,
      usage,
      hitStepLimit,
      assistantMessageId,
      forgeContext,
      sessionRow,
    } = await runTurn({
      job,
      redis,
      events,
      platform,
      db,
      adapter,
      llmKeys,
      workspaceSetup,
      approvedPlan,
      setActivity: (activity) => {
        currentActivity = activity;
      },
    });

    summaryParts = assistantParts;

    if (sessionRow?.repoPath || job.repos?.length) {
      prMeta = await createPrsForChangedRepos({
        job,
        db,
        adapter,
        sessionRow: {
          title: sessionRow?.title ?? "Agent changes",
          branch: sessionRow?.branch ?? null,
          baseBranch: sessionRow?.baseBranch ?? null,
          repoPath: sessionRow?.repoPath ?? null,
          forgeType: sessionRow?.forgeType ?? null,
          userId: sessionRow?.userId ?? job.userId,
        },
        forgeContext,
      });
    }

    let finalMessageId = assistantMessageId;
    if (assistantParts.length > 0) {
      finalMessageId = await upsertAssistantMessage(db, events, job, assistantParts, responseMessages, assistantMessageId, job.requestId);
    }

    const terminalReason = hitStepLimit ? "step_limit" : "end_turn";
    await finalizeRunTerminal({
      db,
      events,
      redis,
      job,
      outcome: "completed",
      terminalReason,
      assistantParts,
      usage,
      assistantMessageId: finalMessageId,
      prMeta,
    });

    const [session] = await db
      .select({ prNumber: sessions.prNumber, prStatus: sessions.prStatus })
      .from(sessions)
      .where(eq(sessions.id, job.sessionId))
      .limit(1);
    if (session && isDeliverComplete(session)) {
      await transitionToComplete(db, job.sessionId);
      await publishEvent(events, job.runId, evt("session:phase_changed", { phase: "complete" }), job.requestId);
    }
  } catch (error) {
    // Handle user-initiated abort
    if (error instanceof AbortError) {
      summaryParts = error.parts;
      await finalizeRunTerminal({
        db,
        events,
        redis,
        job,
        outcome: "aborted",
        terminalReason: "stopped",
        assistantParts: error.parts,
        prMeta,
        fileStats: computeFileStatsFromParts(error.parts),
      });
      return;
    }

    if (isTimeoutAbort(error)) {
      await finalizeRunTerminal({
        db,
        events,
        redis,
        job,
        outcome: "aborted",
        terminalReason: "timeout",
        assistantParts: summaryParts,
        prMeta,
        fileStats: computeFileStatsFromParts(summaryParts),
      });
      return;
    }

    const terminalReason = error instanceof AppError && error.retryable ? "provider_transient" : "internal";
    await finalizeRunTerminal({
      db,
      events,
      redis,
      job,
      outcome: "failed",
      terminalReason,
      assistantParts: summaryParts,
      prMeta,
      fileStats: computeFileStatsFromParts(summaryParts),
      error,
    });
    throw error;
  } finally {
    stopRunHeartbeat();
  }
}

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
import { publishEvent, evt, expireRunStream, mergeToolResults, updateRunStatus, upsertAssistantMessage, updateHeartbeat } from "./run-persistence";
import { agentLoop } from "./loop";
import { ObservabilityRecorder } from "./observability";
import { runPlanner } from "./planner";
import { setupWorkspace, repoNameFromPath } from "./workspace";
import { createPrsForChangedRepos, persistSessionSummary } from "./pr-manager";

const MAX_STEPS = parseInt(process.env.MAX_AGENT_STEPS ?? "100", 10);
const RUN_STATUS_TTL = 3600;
const TURN_TIMEOUT_MS = parseInt(process.env.TURN_TIMEOUT_MS ?? String(10 * 60 * 1000), 10);
const PLANNING_ENABLED = process.env.PLANNING_ENABLED === "true";
const APPROVAL_POLL_INTERVAL_MS = 2000;
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

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

  const resolvedSkillContents = job.resolvedSkills
    ?.filter((s) => s.content)
    .map((s) => ({ slug: s.slug, content: s.content! }));

  const base = buildAgentSystemPrompt({
    skillIndex,
    resolvedSkillContents,
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
  const { job, redis, events, db, adapter, llmKeys, platform, workspaceSetup } = params;
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

  let currentActivity = "idle";
  const heartbeatInterval = setInterval(async () => {
    await updateHeartbeat(db, job.runId);
    publishEvent(events, job.runId, evt("agent:heartbeat", {
      timestamp: new Date().toISOString(),
      activity: currentActivity,
      step: 0,
    }), reqId).catch(() => {});
  }, 15_000);

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

    const skillsSuffix = !isScratch && job.resolvedSkills.length > 0
      ? `## Important notes\n- All git operations target the forge. Authentication is automatic.\n- When creating a PR, push your branch first with the git tool, then use create_pull_request.\n- The repository is already cloned in your workspace. Use glob/grep to explore it.`
      : "";

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
      skillsPromptSuffix: skillsSuffix,
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
        currentActivity = "llm_call";
        publishEvent(events, job.runId, evt("agent:message", { content: token }), reqId).catch((err) => {
          console.warn("[agent] Failed to publish token event:", err);
        });
      },
      onStep: async ({ text, toolCalls, toolResults }) => {
        currentActivity = "tool_execution";

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
    clearInterval(heartbeatInterval);
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

  const setupHeartbeat = setInterval(async () => {
    await updateHeartbeat(db, job.runId);
  }, 15_000);

  let adapter: SandboxAdapter | undefined;
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
    if (PLANNING_ENABLED && !isContinuation) {
      console.info(`[agent][${job.runId}] entering planning phase`);
      await runPlanner({ job, redis, events, db, adapter });

      await events.setKey(`run:${job.runId}:awaiting_approval`, "1", APPROVAL_TIMEOUT_MS / 1000);

      let approved = false;
      const approvalStart = Date.now();
      while (Date.now() - approvalStart < APPROVAL_TIMEOUT_MS) {
        const steeringEvents = await events.consumeSteering(job.runId);
        const approval = steeringEvents.find(
          (e) => e.type === "user:plan_approved" || e.type === "user:plan_rejected",
        );
        if (approval) {
          console.info(`[agent][${job.runId}] plan ${approval.type === "user:plan_approved" ? "approved" : "rejected"}`, { waitMs: Date.now() - approvalStart });
          if (approval.type === "user:plan_approved") {
            approved = true;
            await publishEvent(events, job.runId, evt("plan:approved", { reason: approval.reason }), job.requestId);
          } else {
            await publishEvent(events, job.runId, evt("plan:rejected", { reason: approval.reason }), job.requestId);
            await updateRunStatus(db, job, "completed", undefined, "end_turn");
            await publishEvent(events, job.runId, evt("session:completed", {
              terminalReason: "plan_rejected",
            }), job.requestId);
            await events.setKey(`run:${job.runId}:status`, "completed", RUN_STATUS_TTL);
            await expireRunStream(redis, job.runId);
            return;
          }
          break;
        }
        await new Promise((r) => setTimeout(r, APPROVAL_POLL_INTERVAL_MS));
      }

      if (!approved) {
        await publishEvent(events, job.runId, evt("plan:rejected", { reason: "approval_timeout" }), job.requestId);
        await updateRunStatus(db, job, "completed", undefined, "end_turn");
        await publishEvent(events, job.runId, evt("session:completed", {
          terminalReason: "plan_rejected",
        }), job.requestId);
        await events.setKey(`run:${job.runId}:status`, "completed", RUN_STATUS_TTL);
        await expireRunStream(redis, job.runId);
        return;
      }
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
    console.info("[agent] run_terminal", { runId: job.runId, sessionId: job.sessionId, terminalReason, status: "completed" });
    await updateRunStatus(db, job, "completed", usage, terminalReason);

    await persistSessionSummary({
      db,
      job,
      outcome: "completed",
      assistantParts,
      ...prMeta,
    });

    await publishEvent(
      events,
      job.runId,
      evt("session:completed", { assistantMessageId: finalMessageId, assistantParts: assistantParts as unknown[], terminalReason }),
      job.requestId,
    );
    await events.setKey(`run:${job.runId}:status`, "completed", RUN_STATUS_TTL);
    await expireRunStream(redis, job.runId);

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
      const fileStats = computeFileStatsFromParts(error.parts);
      console.info("[agent] run_terminal", { runId: job.runId, sessionId: job.sessionId, terminalReason: "stopped", status: "aborted" });
      await updateRunStatus(db, job, "aborted", undefined, "stopped");
      await persistSessionSummary({
        db,
        job,
        outcome: "aborted",
        assistantParts: error.parts,
        ...prMeta,
        ...fileStats,
      });
      await publishEvent(events, job.runId, evt("session:aborted", { terminalReason: "stopped" }), job.requestId);
      await events.setKey(`run:${job.runId}:status`, "aborted", RUN_STATUS_TTL);
      await expireRunStream(redis, job.runId);
      return;
    }

    // Handle turn timeout (native AbortError from fetch/signal)
    if (isTimeoutAbort(error)) {
      const fileStats = computeFileStatsFromParts(summaryParts);
      console.info("[agent] run_terminal", { runId: job.runId, sessionId: job.sessionId, terminalReason: "timeout", status: "aborted" });
      await updateRunStatus(db, job, "aborted", undefined, "timeout");
      await persistSessionSummary({
        db,
        job,
        outcome: "aborted",
        assistantParts: summaryParts,
        ...prMeta,
        ...fileStats,
      });
      await publishEvent(events, job.runId, evt("session:aborted", { terminalReason: "timeout" }), job.requestId);
      await events.setKey(`run:${job.runId}:status`, "aborted", RUN_STATUS_TTL);
      await expireRunStream(redis, job.runId);
      return;
    }

    const terminalReason = error instanceof AppError && error.retryable ? "provider_transient" : "internal";
    const fileStats = computeFileStatsFromParts(summaryParts);
    console.info("[agent] run_terminal", { runId: job.runId, sessionId: job.sessionId, terminalReason, status: "failed", error: error instanceof Error ? error.message : String(error) });
    await updateRunStatus(db, job, "failed", undefined, terminalReason);
    await persistSessionSummary({
      db,
      job,
      outcome: "failed",
      assistantParts: summaryParts,
      ...prMeta,
      ...fileStats,
    });
    await publishEvent(
      events,
      job.runId,
      evt("session:failed", {
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        requestId: job.requestId,
        retryable: error instanceof AppError ? error.retryable : false,
        terminalReason,
      }),
      job.requestId,
    );
    await events.setKey(`run:${job.runId}:status`, "failed", RUN_STATUS_TTL);
    await expireRunStream(redis, job.runId);
    throw error;
  } finally {
    clearInterval(setupHeartbeat);
  }
}

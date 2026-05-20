import type Redis from "ioredis";
import { eq } from "drizzle-orm";
import { agentRuns, chats, sessions, prEvents, projects, projectRepos } from "@openforge/db";
import { AppError } from "@openforge/shared";
import { resolveLlmApiKeys, type ResolvedLlmKeys, type PlatformContainer, type PlatformDb, type EventBus } from "@openforge/platform";
import type { SandboxAdapter } from "@openforge/sandbox";
import type { ForgeAgentContext } from "./context/agent-context";
import type { LLMMessage } from "./llm";
import { jobMessagesToLLMMessages, sanitizeMessages } from "./messages";
import { buildAgentSystemPrompt, FORGE_LABELS } from "./system-prompt";
import { getModel, getModelDef } from "./models";
import type { AgentJob, StreamEvent, AssistantPart } from "./types";
import { isDeliverComplete, transitionToComplete } from "./lib/deliver";
import { rewriteForSandbox } from "./sandbox-url";
import { getForgeProvider, getForgeProviderForSession, resolveUpstreamMirror, getAdapter, triggerMirrorSync } from "./providers";
import { buildToolSet } from "./tool-registry";
import { publishEvent, expireRunStream, mergeToolResults, persistAssistantMessage, updateRunStatus } from "./run-persistence";
import { agentLoop } from "./loop";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_STEPS = 100;
const RUN_STATUS_TTL = 3600;
const TURN_TIMEOUT_MS = 5 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

class AbortError extends Error {
  constructor(public readonly parts: AssistantPart[]) {
    super("ABORTED");
    this.name = "AbortError";
  }
}

async function isAborted(events: EventBus, runId: string): Promise<boolean> {
  const val = await events.getKey(`run:${runId}:abort`);
  return val === "1";
}

// ─── Message building ────────────────────────────────────────────────────────

function buildModelMessages(job: AgentJob): LLMMessage[] {
  const raw = job.modelMessages?.length
    ? (job.modelMessages as LLMMessage[])
    : jobMessagesToLLMMessages(job.messages);
  return sanitizeMessages(raw, job.chatId);
}

// ─── System prompt & context ─────────────────────────────────────────────────

function buildThinkingParams(job: AgentJob) {
  const modelDef = getModelDef(job.modelId);
  const isAnthropic = modelDef.provider === "anthropic";
  const thinkingType = isAnthropic ? modelDef.thinkingType : undefined;

  if (!thinkingType) return undefined;
  return thinkingType === "adaptive"
    ? { type: "adaptive" as const, budgetTokens: 16000 }
    : { type: "enabled" as const, budgetTokens: 8000 };
}

function buildSystemPromptForJob(job: AgentJob, forgeType?: string, isScratch = false): string {
  const appended = [job.fixContext].filter(Boolean).join("\n\n");
  const base = buildAgentSystemPrompt({
    skills: job.resolvedSkills,
    projectContext: job.projectContext,
    projectConfig: job.projectConfig,
    forgeLabel: FORGE_LABELS[forgeType ?? "github"],
    isScratch,
  });
  return appended ? `${base}\n\n${appended}` : base;
}

function buildWorkspaceContext(
  sessionRow: { repoPath: string | null; branch: string | null; baseBranch: string | null; userId?: string } | undefined,
  ctx: ForgeAgentContext,
): string | null {
  if (!sessionRow) return null;

  if (!sessionRow.repoPath) {
    const scratchDir = `/workspace/scratch/${sessionRow.userId ?? ctx.sessionId}`;
    return [
      "# Workspace",
      "",
      "- **Mode:** Scratch workbench (no repository attached)",
      `- **Working directory:** \`${scratchDir}\` — a persistent personal workspace. You can create files, run commands, and prototype freely here.`,
      "- To connect this work to a repository later, the user can select one and you can use git init, push, etc.",
    ].join("\n");
  }

  const workdir = `/workspace/${ctx.sessionId}`;

  const lines = [
    "# Workspace",
    "",
    `- **Repository:** ${sessionRow.repoPath}`,
    `- **Branch:** ${sessionRow.branch || "main"}`,
    `- **Base branch:** ${sessionRow.baseBranch || "main"}`,
    `- **Working directory:** \`${workdir}\` — the repo is cloned here. All bash and git commands execute in this directory automatically. Do NOT \`cd\` elsewhere; \`cd\` does not persist between commands.`,
  ];

  if (ctx.repoOwner && ctx.repoName) {
    lines.push(`- **Owner:** ${ctx.repoOwner}`);
  }

  if (ctx.upstream) {
    lines.push(
      `- **Upstream:** ${ctx.upstream.provider} — ${ctx.upstream.remoteOwner}/${ctx.upstream.remoteRepo} (push and PRs target the upstream, not the internal forge)`,
    );
  }

  return lines.join("\n");
}


// ─── Forge context construction ──────────────────────────────────────────────

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

  const [sessionRow] = await db
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
    .limit(1);

  const isScratch = !sessionRow?.repoPath;
  const forgeType = sessionRow?.forgeType ?? "github";

  let forge;
  try {
    forge = forgeType === "forgejo"
      ? getForgeProvider()
      : await getForgeProviderForSession(db, { forgeType, userId: sessionRow?.userId ?? job.userId });
  } catch {
    forge = getForgeProvider();
  }

  const repoPath = sessionRow?.repoPath ?? "";
  const [repoOwner, repoName] = repoPath.split("/");

  const upstream = !isScratch && forgeType === "forgejo"
    ? await resolveUpstreamMirror(db, repoPath)
    : undefined;
  if (upstream) {
    console.log(`[agent] upstream mirror detected: ${upstream.provider} ${upstream.remoteOwner}/${upstream.remoteRepo}`);
  }

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
    upstream,
    onFileChanged: async (p) => {
      const ev: StreamEvent = {
        type: "file_changed",
        path: p.path,
        additions: p.additions,
        deletions: p.deletions,
        unifiedDiffPreview: p.unifiedDiffPreview,
      };
      await publishEvent(events, job.runId, ev, reqId);
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

      if (upstream && repoOwner && repoName) {
        triggerMirrorSync(forge, repoOwner, repoName);
      }
    },
  };

  return { forgeContext, sessionRow };
}

// ─── Project context ─────────────────────────────────────────────────────────

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

// ─── Core turn execution ─────────────────────────────────────────────────────

async function runTurn(params: {
  job: AgentJob;
  redis: Redis;
  events: EventBus;
  db: PlatformDb;
  adapter: SandboxAdapter;
  llmKeys: ResolvedLlmKeys;
}): Promise<{
  text: string;
  assistantParts: AssistantPart[];
  responseMessages: LLMMessage[];
  usage: { promptTokens?: number; completionTokens?: number };
  hitStepLimit: boolean;
}> {
  const { job, redis, events, db, adapter, llmKeys } = params;
  const { provider, modelId } = getModel(job.modelId, llmKeys);
  const thinkingParams = buildThinkingParams(job);

  const reqId = job.requestId;
  const assistantParts: AssistantPart[] = [];

  const { forgeContext, sessionRow } = await buildForgeContext({ job, db, events, adapter, assistantParts });

  const isScratch = !sessionRow?.repoPath;
  const sessionForgeType = sessionRow?.forgeType ?? "github";
  const basePrompt = isScratch
    ? buildSystemPromptForJob(job, sessionForgeType, true)
    : buildSystemPromptForJob(job, sessionForgeType);
  const workspaceBlock = buildWorkspaceContext(sessionRow, forgeContext);
  let systemPrompt = workspaceBlock ? `${basePrompt}\n\n${workspaceBlock}` : basePrompt;

  const projectBlock = await buildProjectBlock(db, sessionRow?.projectId ?? null);
  if (projectBlock) {
    systemPrompt = `${systemPrompt}\n\n${projectBlock}`;
  }

  const skillsSuffix = !isScratch && job.resolvedSkills.length > 0
    ? `## Important notes\n- All git operations target the forge. Authentication is automatic.\n- When creating a PR, push your branch first with the git tool, then use create_pull_request.\n- The repository is already cloned in your workspace. Use glob/grep to explore it.`
    : "";

  const tools = buildToolSet(events, redis, db, job, provider, modelId, forgeContext, skillsSuffix, !isScratch);
  const inputMessages = buildModelMessages(job);

  console.log(
    `[agent] runId=${job.runId} skills=${job.resolvedSkills.map((s) => s.slug).join(",")} messages=${inputMessages.length}`,
  );

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), TURN_TIMEOUT_MS);

  let result;
  try {
    result = await agentLoop({
      provider,
      model: modelId,
      system: systemPrompt,
      messages: inputMessages,
      tools,
      maxSteps: MAX_STEPS,
      signal: abortController.signal,
      thinking: thinkingParams,
      shouldAbort: async () => {
        if (await isAborted(events, job.runId)) {
          throw new AbortError(assistantParts);
        }
        return false;
      },
      onToken: (token) => {
        publishEvent(events, job.runId, { type: "token", token }, reqId).catch(() => {});
      },
      onStep: async ({ text, toolCalls, toolResults, usage }) => {
        if (text) {
          assistantParts.push({ type: "text", text });
        }

        for (const tc of toolCalls) {
          const ev: StreamEvent = { type: "tool_call", toolName: tc.toolName, toolCallId: tc.toolCallId, args: tc.input };
          assistantParts.push({ type: "tool_call", toolName: tc.toolName, toolCallId: tc.toolCallId, args: tc.input });
          await publishEvent(events, job.runId, ev, reqId);
        }

        for (const tr of toolResults) {
          const ev: StreamEvent = { type: "tool_result", toolCallId: tr.toolCallId, result: tr.output };
          assistantParts.push({ type: "tool_result", toolCallId: tr.toolCallId, result: tr.output });
          await publishEvent(events, job.runId, ev, reqId);
        }
      },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (result.hitStepLimit) {
    const limitMsg = `Reached the maximum step limit (${MAX_STEPS}). Send another message to continue where I left off.`;
    assistantParts.push({ type: "text", text: limitMsg });
    await publishEvent(events, job.runId, { type: "token", token: limitMsg }, reqId);
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
  };
}

// ─── Repo cloning ────────────────────────────────────────────────────────────

async function ensureScratchWorkspace(adapter: SandboxAdapter, userId: string): Promise<void> {
  const scratchId = `scratch/${userId}`;
  await adapter.exec(scratchId, "mkdir -p .").catch(() => {});
  console.log(`[scratch] ensured workspace for user ${userId}`);
}

async function ensureRepoCloned(db: PlatformDb, job: AgentJob, adapter: SandboxAdapter): Promise<void> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, job.sessionId)).limit(1);
  if (!session?.repoPath) {
    await ensureScratchWorkspace(adapter, job.userId);
    return;
  }

  const globResult = await adapter.glob(job.sessionId, "*").catch(() => ({ files: [] as string[] }));
  if (globResult.files.length > 0) return;

  const forge = await getForgeProviderForSession(db, session);
  const [owner, repo] = session.repoPath.split("/");
  if (!owner || !repo) return;

  const forgeType = session.forgeType ?? "github";
  const isForgejo = forgeType === "forgejo";

  const rawAuthUrl = forge.git.authenticatedCloneUrl(owner, repo);
  const rawPlainUrl = forge.git.plainCloneUrl(owner, repo);
  const authenticatedUrl = isForgejo ? rewriteForSandbox(rawAuthUrl) : rawAuthUrl;
  const plainUrl = isForgejo ? rewriteForSandbox(rawPlainUrl) : rawPlainUrl;

  const cloneArgs = ["clone", "--depth", "50"];
  if (session.branch) cloneArgs.push("--branch", session.branch);
  cloneArgs.push(authenticatedUrl, ".");

  console.log(`[clone] cloning ${session.repoPath} for session ${job.sessionId}`);
  const result = await adapter.git(job.sessionId, cloneArgs);
  if (result.exitCode !== 0) {
    const branchNotFound = result.stderr?.includes("not found in upstream") ||
      result.stderr?.includes("Remote branch") && result.stderr?.includes("not found");

    if (branchNotFound && session.branch) {
      console.log(`[clone] branch "${session.branch}" not found, cloning default branch`);
      const defaultArgs = ["clone", "--depth", "50", authenticatedUrl, "."];
      const defaultResult = await adapter.git(job.sessionId, defaultArgs);
      if (defaultResult.exitCode !== 0) {
        console.error(`[clone] default branch clone failed for session ${job.sessionId}:`, defaultResult.stderr);
        return;
      }
      const checkout = await adapter.git(job.sessionId, ["checkout", "-b", session.branch]);
      if (checkout.exitCode !== 0) {
        console.error(`[clone] branch creation failed for session ${job.sessionId}:`, checkout.stderr);
        return;
      }
    } else {
      console.error(`[clone] failed for session ${job.sessionId}:`, result.stderr);
      const fullArgs = ["clone"];
      if (session.branch) fullArgs.push("--branch", session.branch);
      fullArgs.push(authenticatedUrl, ".");
      const retry = await adapter.git(job.sessionId, fullArgs);
      if (retry.exitCode !== 0) {
        console.error(`[clone] full clone also failed for session ${job.sessionId}:`, retry.stderr);
        return;
      }
    }
  }
  console.log(`[clone] success for session ${job.sessionId}`);
  await adapter.git(job.sessionId, ["remote", "set-url", "origin", plainUrl]);
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runAgentTurn(job: AgentJob, redis: Redis, platform: PlatformContainer): Promise<void> {
  const { db, events } = platform;
  const adapter = await getAdapter(job.sessionId);

  try {
    await db.update(agentRuns).set({ status: "running", startedAt: new Date() }).where(eq(agentRuns.id, job.runId));
    await events.setKey(`run:${job.runId}:status`, "running", RUN_STATUS_TTL);

    await ensureRepoCloned(db, job, adapter);

    const llmKeys = await resolveLlmApiKeys(db, job.userId);

    const { assistantParts, responseMessages, usage } = await runTurn({
      job,
      redis,
      events,
      db,
      adapter,
      llmKeys,
    });

    let assistantMessageId: string | undefined;
    if (assistantParts.length > 0) {
      assistantMessageId = await persistAssistantMessage(db, job, assistantParts, responseMessages);
    }

    await updateRunStatus(db, job, "completed", usage);

    await publishEvent(
      events,
      job.runId,
      { type: "done", assistantMessageId, assistantParts: assistantParts as unknown[] },
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
      await publishEvent(events, job.runId, { type: "phase_changed", phase: "complete" } as unknown as StreamEvent, job.requestId);
    }
  } catch (error) {
    if (error instanceof AbortError) {
      const mergedParts = mergeToolResults(error.parts);
      if (mergedParts.length > 0) {
        await persistAssistantMessage(db, job, mergedParts, []).catch((e) =>
          console.error("[agent] Failed to persist partial abort work:", e),
        );
      }
      await updateRunStatus(db, job, "aborted");
      await publishEvent(events, job.runId, { type: "aborted" }, job.requestId);
      await events.setKey(`run:${job.runId}:status`, "aborted", RUN_STATUS_TTL);
      await expireRunStream(redis, job.runId);
      return;
    }

    await updateRunStatus(db, job, "failed");
    await publishEvent(
      events,
      job.runId,
      {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        requestId: job.requestId,
        retryable: error instanceof AppError ? error.retryable : false,
      },
      job.requestId,
    );
    await events.setKey(`run:${job.runId}:status`, "failed", RUN_STATUS_TTL);
    await expireRunStream(redis, job.runId);
    throw error;
  }
}

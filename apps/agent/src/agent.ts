import type Redis from "ioredis";
import { eq } from "drizzle-orm";
import { agentRuns, chatMessages, sessions, prEvents, projects, projectRepos } from "@coding-agents/db";
import { AppError, type SessionSummary } from "@coding-agents/shared";
import { resolveLlmApiKeys, type ResolvedLlmKeys, type PlatformContainer, type PlatformDb, type EventBus } from "@coding-agents/platform";
import type { SandboxAdapter } from "@coding-agents/sandbox";
import type { ForgeAgentContext } from "./context/agent-context";
import type { LLMMessage } from "./llm";
import { jobMessagesToLLMMessages, sanitizeMessages } from "./messages";
import { buildAgentSystemPrompt, FORGE_LABELS } from "./system-prompt";
import { listBuiltinSummaries } from "./skills";
import { getModel, getModelDef } from "./models";
import type { AgentJob, StreamEvent, AssistantPart } from "./types";
import { isDeliverComplete, transitionToComplete } from "./lib/deliver";
import { getForgeProviderForSession, getAdapter } from "./providers";
import { buildToolSet } from "./tool-registry";
import { publishEvent, expireRunStream, mergeToolResults, updateRunStatus, upsertAssistantMessage, updateHeartbeat } from "./run-persistence";
import { agentLoop } from "./loop";
import { ObservabilityRecorder } from "./observability";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_STEPS = parseInt(process.env.MAX_AGENT_STEPS ?? "100", 10);
const RUN_STATUS_TTL = 3600;
const TURN_TIMEOUT_MS = parseInt(process.env.TURN_TIMEOUT_MS ?? String(10 * 60 * 1000), 10);

// ─── Helpers ─────────────────────────────────────────────────────────────────

class AbortError extends Error {
  constructor(public readonly parts: AssistantPart[]) {
    super("ABORTED");
    this.name = "AbortError";
  }
}

function isTimeoutAbort(error: unknown): boolean {
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

// ─── Message building ────────────────────────────────────────────────────────

function buildModelMessages(job: AgentJob): LLMMessage[] {
  const raw = job.modelMessages?.length
    ? (job.modelMessages as LLMMessage[])
    : jobMessagesToLLMMessages(job.messages);
  return sanitizeMessages(raw);
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

function repoNameFromPath(repoPath: string): string {
  return repoPath.split("/").pop() ?? repoPath;
}

function buildWorkspaceContext(
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
    publishEvent(events, job.runId, {
      type: "heartbeat",
      timestamp: new Date().toISOString(),
      activity: currentActivity,
      step: 0,
    }, reqId).catch(() => {});
  }, 15_000);

  const { forgeContext, sessionRow } = await buildForgeContext({ job, db, events, adapter, assistantParts });

  const isScratch = !sessionRow?.repoPath && !job.repos?.length;
  const basePrompt = buildSystemPromptForJob(job, isScratch);
  const workspaceBlock = buildWorkspaceContext(sessionRow, forgeContext, {
    workdir: workspaceSetup.workdir,
    repos: job.repos,
  });
  let systemPrompt = workspaceBlock ? `${basePrompt}\n\n${workspaceBlock}` : basePrompt;

  const projectBlock = await buildProjectBlock(db, sessionRow?.projectId ?? null);
  if (projectBlock) {
    systemPrompt = `${systemPrompt}\n\n${projectBlock}`;
  }

  const skillsSuffix = !isScratch && job.resolvedSkills.length > 0
    ? `## Important notes\n- All git operations target the forge. Authentication is automatic.\n- When creating a PR, push your branch first with the git tool, then use create_pull_request.\n- The repository is already cloned in your workspace. Use glob/grep to explore it.`
    : "";

  const resultStore = new Map<string, string>();
  const tools = buildToolSet(events, redis, db, job, provider, modelId, forgeContext, skillsSuffix, !isScratch, resultStore, llmKeys);
  const inputMessages = buildModelMessages(job);

  console.log(
    `[agent] runId=${job.runId} skills=${job.resolvedSkills.map((s) => s.slug).join(",")} messages=${inputMessages.length}`,
  );

  const { controller: abortController, cleanup: cleanupAbort } = createMergedAbortController(events, job.runId, TURN_TIMEOUT_MS);

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
      resultStore,
      recorder,
      secrets: job.resolvedSecrets,
      shouldAbort: async () => {
        if (await isAborted(events, job.runId)) {
          throw new AbortError(assistantParts);
        }
        return false;
      },
      onToken: (token) => {
        currentActivity = "llm_call";
        publishEvent(events, job.runId, { type: "token", token }, reqId).catch((err) => {
          console.warn("[agent] Failed to publish token event:", err);
        });
      },
      onStep: async ({ text, toolCalls, toolResults }) => {
        currentActivity = "tool_execution";

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

        try {
          assistantMessageId = await upsertAssistantMessage(
            db, events, job, assistantParts, [], assistantMessageId, reqId
          );
        } catch (err) {
          console.warn("[agent] Incremental persist failed:", err);
        }
      },
    });
  } finally {
    cleanupAbort();
    clearInterval(heartbeatInterval);
    await recorder.close();
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
    terminationReason: result.terminationReason,
    assistantMessageId,
    forgeContext,
    sessionRow,
  };
}

// ─── Repo cloning ────────────────────────────────────────────────────────────

async function ensureScratchWorkspace(adapter: SandboxAdapter, userId: string): Promise<void> {
  const scratchId = `scratch/${userId}`;
  await adapter.exec(scratchId, "mkdir -p .").catch(() => {});
  console.log(`[scratch] ensured workspace for user ${userId}`);
}

class CloneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloneError";
  }
}

async function tryClone(
  adapter: SandboxAdapter,
  sessionId: string,
  args: string[],
): Promise<{ exitCode: number; stderr: string }> {
  const result = await adapter.git(sessionId, args);
  return { exitCode: result.exitCode, stderr: result.stderr ?? "" };
}

async function scheduleBackgroundMirrorCreation(
  adapter: SandboxAdapter,
  job: AgentJob,
  repoPath: string,
  cloneUrl: string,
): Promise<void> {
  if (!job.workspaceId) return;
  try {
    const result = await adapter.ensureMirror(job.sessionId, job.workspaceId, repoPath, cloneUrl);
    console.log(`[mirror] background ensureMirror for ${repoPath}: ${result.status}`);
  } catch (err) {
    console.warn(
      `[mirror] background ensureMirror failed for ${repoPath}:`,
      err instanceof Error ? err.message : err,
    );
  }
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

  const authenticatedUrl = forge.git.authenticatedCloneUrl(owner, repo);
  const plainUrl = forge.git.plainCloneUrl(owner, repo);

  console.log(`[clone] cloning ${session.repoPath} for session ${job.sessionId}`);

  // Attempt 1: shallow clone with branch
  const shallowArgs = ["clone", "--depth", "50"];
  if (session.branch) shallowArgs.push("--branch", session.branch);
  shallowArgs.push(authenticatedUrl, ".");

  const result = await tryClone(adapter, job.sessionId, shallowArgs);
  if (result.exitCode === 0) {
    console.log(`[clone] success for session ${job.sessionId}`);
    await adapter.git(job.sessionId, ["remote", "set-url", "origin", plainUrl]);
    void scheduleBackgroundMirrorCreation(adapter, job, session.repoPath, authenticatedUrl);
    return;
  }

  const branchNotFound = result.stderr.includes("not found in upstream") ||
    (result.stderr.includes("Remote branch") && result.stderr.includes("not found"));

  if (branchNotFound && session.branch) {
    // Attempt 2: clone default branch, then create the target branch
    console.log(`[clone] branch "${session.branch}" not found, cloning default branch`);
    const defaultResult = await tryClone(adapter, job.sessionId, ["clone", "--depth", "50", authenticatedUrl, "."]);
    if (defaultResult.exitCode !== 0) {
      throw new CloneError(`Clone failed for session ${job.sessionId}: ${defaultResult.stderr}`);
    }
    const checkout = await adapter.git(job.sessionId, ["checkout", "-b", session.branch]);
    if (checkout.exitCode !== 0) {
      throw new CloneError(`Branch creation failed for session ${job.sessionId}: ${checkout.stderr}`);
    }
  } else {
    // Attempt 3: full (non-shallow) clone
    console.log(`[clone] shallow clone failed, retrying full clone for session ${job.sessionId}`);
    const fullArgs = ["clone"];
    if (session.branch) fullArgs.push("--branch", session.branch);
    fullArgs.push(authenticatedUrl, ".");
    const retry = await tryClone(adapter, job.sessionId, fullArgs);
    if (retry.exitCode !== 0) {
      throw new CloneError(`Clone failed for session ${job.sessionId}: ${retry.stderr}`);
    }
  }

  console.log(`[clone] success for session ${job.sessionId}`);
  await adapter.git(job.sessionId, ["remote", "set-url", "origin", plainUrl]);
  void scheduleBackgroundMirrorCreation(adapter, job, session.repoPath, authenticatedUrl);
}

async function repoDirReady(adapter: SandboxAdapter, sessionId: string, repoName: string): Promise<boolean> {
  const result = await adapter
    .exec(sessionId, `test -e "repos/${repoName}/.git" && echo ready`)
    .catch(() => ({ stdout: "", exitCode: 1 }));
  return result.stdout.trim() === "ready";
}

async function cloneRepoIntoSubdir(params: {
  adapter: SandboxAdapter;
  db: PlatformDb;
  job: AgentJob;
  repoPath: string;
  defaultBranch: string;
  branchName: string;
}): Promise<void> {
  const { adapter, db, job, repoPath, defaultBranch, branchName } = params;
  const repoName = repoNameFromPath(repoPath);
  const cloneDir = `repos/${repoName}`;

  const [session] = await db.select().from(sessions).where(eq(sessions.id, job.sessionId)).limit(1);
  const forge = await getForgeProviderForSession(db, {
    forgeType: session?.forgeType ?? "github",
    userId: session?.userId ?? job.userId,
  });
  const [owner, repo] = repoPath.split("/");
  if (!owner || !repo) return;

  const authenticatedUrl = forge.git.authenticatedCloneUrl(owner, repo);
  const plainUrl = forge.git.plainCloneUrl(owner, repo);

  console.log(`[clone] cloning ${repoPath} into ${cloneDir} for session ${job.sessionId}`);

  const shallowResult = await adapter.exec(
    job.sessionId,
    `mkdir -p "${cloneDir}" && git clone --depth 50 --branch "${defaultBranch}" "${authenticatedUrl}" "${cloneDir}"`,
  );
  if (shallowResult.exitCode !== 0) {
    const fullResult = await adapter.exec(
      job.sessionId,
      `rm -rf "${cloneDir}" && mkdir -p "${cloneDir}" && git clone --branch "${defaultBranch}" "${authenticatedUrl}" "${cloneDir}"`,
    );
    if (fullResult.exitCode !== 0) {
      throw new CloneError(`Clone failed for ${repoPath}: ${fullResult.stderr}`);
    }
  }

  await adapter.exec(job.sessionId, `git -C "${cloneDir}" remote set-url origin "${plainUrl}"`);
  const checkout = await adapter.exec(job.sessionId, `git -C "${cloneDir}" checkout -b "${branchName}"`);
  if (checkout.exitCode !== 0) {
    throw new CloneError(`Branch creation failed for ${repoPath}: ${checkout.stderr}`);
  }

  void scheduleBackgroundMirrorCreation(adapter, job, repoPath, authenticatedUrl);
}

async function emitDegradedCloneEvent(
  events: EventBus,
  job: AgentJob,
  repoPath: string,
  reason: string,
): Promise<void> {
  await publishEvent(
    events,
    job.runId,
    {
      type: "heartbeat",
      activity: `Mirror unavailable for ${repoPath}, fell back to clone (${reason})`,
      timestamp: new Date().toISOString(),
    },
    job.requestId,
  );
}

async function setupWorkspace(params: {
  job: AgentJob;
  db: PlatformDb;
  adapter: SandboxAdapter;
  events: EventBus;
}): Promise<{ workdir: string; repoCount: number }> {
  const { job, db, adapter, events } = params;
  const sessionId = job.sessionId;

  if (!job.repos?.length) {
    await ensureRepoCloned(db, job, adapter);
    return { workdir: `/workspace/${sessionId}`, repoCount: 1 };
  }

  const repos = job.repos;
  const workspaceId = job.workspaceId ?? sessionId;
  const branchName = (await db.select({ branch: sessions.branch }).from(sessions).where(eq(sessions.id, sessionId)).limit(1))[0]
    ?.branch ?? `agent/${sessionId}`;

  const allReady = await Promise.all(
    repos.map((repo) => repoDirReady(adapter, sessionId, repoNameFromPath(repo.repoPath))),
  );
  if (!allReady.every(Boolean)) {
    for (const repo of repos) {
      const repoName = repoNameFromPath(repo.repoPath);
      if (await repoDirReady(adapter, sessionId, repoName)) continue;

      const [owner, name] = repo.repoPath.split("/");
      if (!owner || !name) continue;

      const forge = await getForgeProviderForSession(db, {
        forgeType: repo.forgeType ?? "github",
        userId: job.userId,
      });
      const cloneUrl = forge.git.authenticatedCloneUrl(owner, name);

      try {
        const mirror = await adapter.ensureMirror(sessionId, workspaceId, repo.repoPath, cloneUrl);
        if (mirror.status === "error") {
          throw new Error("mirror unavailable");
        }
        await adapter.createWorktree(sessionId, workspaceId, repo.repoPath, branchName, repo.defaultBranch);
        console.log(`[worktree] created for ${repo.repoPath} in session ${sessionId}`);
      } catch (worktreeErr) {
        const reason = worktreeErr instanceof Error ? worktreeErr.message : "worktree failed";
        console.warn(`[worktree] fallback to clone for ${repo.repoPath}:`, reason);
        try {
          await cloneRepoIntoSubdir({
            adapter,
            db,
            job,
            repoPath: repo.repoPath,
            defaultBranch: repo.defaultBranch,
            branchName,
          });
          await emitDegradedCloneEvent(events, job, repo.repoPath, reason);
        } catch (cloneErr) {
          console.error(`[agent] Failed to set up repo ${repo.repoPath}:`, cloneErr);
        }
      }
    }
  }

  const primary = repos.find((r) => r.isPrimary) ?? repos[0];
  const primaryName = primary ? repoNameFromPath(primary.repoPath) : "";
  if (primaryName) {
    await adapter.writeFile(sessionId, ".agent/primary-repo", primaryName).catch(() => {});
  }

  return {
    workdir: `/workspace/${sessionId}/repos/${primaryName}`,
    repoCount: repos.length,
  };
}

async function cleanupWorktrees(job: AgentJob, adapter: SandboxAdapter): Promise<void> {
  if (!job.repos?.length) return;
  for (const repo of job.repos) {
    try {
      await adapter.removeWorktree(job.sessionId, repo.repoPath);
    } catch (err) {
      console.warn(`[worktree] cleanup failed for ${repo.repoPath}:`, err instanceof Error ? err.message : err);
    }
  }
}

function countToolCalls(parts: AssistantPart[]): number {
  return parts.filter((p) => p.type === "tool_call").length;
}

async function collectGitLineStats(
  adapter: SandboxAdapter,
  sessionId: string,
  repoRelDir: string | null,
  baseBranch: string,
): Promise<{ added: number; removed: number; hasChanges: boolean }> {
  const gitPrefix = repoRelDir ? `git -C "${repoRelDir}"` : "git";
  await adapter.exec(sessionId, `${gitPrefix} fetch origin "${baseBranch}" 2>/dev/null || true`).catch(() => {});

  const diffResult = await adapter
    .exec(sessionId, `${gitPrefix} diff --numstat "origin/${baseBranch}"...HEAD 2>/dev/null || ${gitPrefix} diff --numstat HEAD~1..HEAD 2>/dev/null || true`)
    .catch(() => ({ stdout: "", exitCode: 1 }));

  let added = 0;
  let removed = 0;
  for (const line of diffResult.stdout.split("\n")) {
    const [a, d] = line.split("\t");
    if (a && d && a !== "-" && d !== "-") {
      added += parseInt(a, 10) || 0;
      removed += parseInt(d, 10) || 0;
    }
  }

  const hasChanges = added > 0 || removed > 0;
  return { added, removed, hasChanges };
}

async function pushRepoBranch(params: {
  adapter: SandboxAdapter;
  forge: Awaited<ReturnType<typeof getForgeProviderForSession>>;
  sessionId: string;
  repoRelDir: string | null;
  repoPath: string;
  branch: string;
}): Promise<{ ok: boolean; stderr: string }> {
  const { adapter, forge, sessionId, repoRelDir, repoPath, branch } = params;
  const [owner, repo] = repoPath.split("/");
  if (!owner || !repo) return { ok: false, stderr: "invalid repo path" };

  const authUrl = forge.git.authenticatedCloneUrl(owner, repo);
  const plainUrl = forge.git.plainCloneUrl(owner, repo);
  const gitPrefix = repoRelDir ? `git -C "${repoRelDir}"` : "git";

  await adapter.exec(sessionId, `${gitPrefix} remote set-url origin "${authUrl}"`).catch(() => {});
  try {
    const pushResult = await adapter.exec(sessionId, `${gitPrefix} push -u origin "${branch}"`);
    return { ok: pushResult.exitCode === 0, stderr: pushResult.stderr };
  } finally {
    await adapter.exec(sessionId, `${gitPrefix} remote set-url origin "${plainUrl}"`).catch(() => {});
  }
}

async function createPrsForChangedRepos(params: {
  job: AgentJob;
  db: PlatformDb;
  adapter: SandboxAdapter;
  sessionRow: { title: string; branch: string | null; baseBranch: string | null; repoPath: string | null; forgeType: string | null; userId: string };
  forgeContext: ForgeAgentContext;
}): Promise<{ prUrls: string[]; reposTouched: string[]; linesAdded: number; linesRemoved: number }> {
  const { job, db, adapter, sessionRow, forgeContext } = params;
  const branch = sessionRow.branch ?? `agent/${job.sessionId}`;
  const baseBranch = sessionRow.baseBranch ?? "main";
  const prUrls: string[] = [];
  const reposTouched: string[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;

  const repoEntries =
    job.repos?.map((r) => ({
      repoPath: r.repoPath,
      relDir: `repos/${repoNameFromPath(r.repoPath)}`,
      isPrimary: r.isPrimary,
      defaultBranch: r.defaultBranch,
    })) ??
    (sessionRow.repoPath
      ? [{ repoPath: sessionRow.repoPath, relDir: null as string | null, isPrimary: true, defaultBranch: baseBranch }]
      : []);

  for (const entry of repoEntries) {
    const base = entry.defaultBranch || baseBranch;
    const stats = await collectGitLineStats(adapter, job.sessionId, entry.relDir, base);
    linesAdded += stats.added;
    linesRemoved += stats.removed;
    if (!stats.hasChanges) continue;

    reposTouched.push(entry.repoPath);
    const [owner, repo] = entry.repoPath.split("/");
    if (!owner || !repo) continue;

    const push = await pushRepoBranch({
      adapter,
      forge: forgeContext.forge,
      sessionId: job.sessionId,
      repoRelDir: entry.relDir,
      repoPath: entry.repoPath,
      branch,
    });
    if (!push.ok) {
      console.warn(`[pr] push failed for ${entry.repoPath}: ${push.stderr}`);
      continue;
    }

    try {
      const pr = await forgeContext.forge.pulls.create({
        owner,
        repo,
        head: branch,
        base,
        title: sessionRow.title || `Agent changes (${entry.repoPath})`,
        body: `Automated PR from agent session ${job.sessionId}.`,
      });
      prUrls.push(pr.htmlUrl);

      if (entry.isPrimary) {
        await forgeContext.onPrCreated?.({ prNumber: pr.number, prStatus: "open" });
      } else {
        await db.insert(prEvents).values({
          id: crypto.randomUUID(),
          userId: job.userId,
          sessionId: job.sessionId,
          repoPath: entry.repoPath,
          prNumber: pr.number,
          action: "opened",
          title: sessionRow.title ?? "PR",
          actionNeeded: true,
          metadata: { createdByAgent: true, runId: job.runId },
        });
      }
    } catch (err) {
      console.warn(`[pr] create failed for ${entry.repoPath}:`, err instanceof Error ? err.message : err);
    }
  }

  return { prUrls, reposTouched, linesAdded, linesRemoved };
}

async function persistSessionSummary(params: {
  db: PlatformDb;
  job: AgentJob;
  outcome: SessionSummary["outcome"];
  assistantParts: AssistantPart[];
  prUrls: string[];
  reposTouched: string[];
  linesAdded: number;
  linesRemoved: number;
}): Promise<void> {
  const { db, job, outcome, assistantParts, prUrls, reposTouched, linesAdded, linesRemoved } = params;

  const [runRow] = await db
    .select({ startedAt: agentRuns.startedAt, totalDurationMs: agentRuns.totalDurationMs, costUsd: agentRuns.costUsd })
    .from(agentRuns)
    .where(eq(agentRuns.id, job.runId))
    .limit(1);

  const durationMs =
    runRow?.totalDurationMs ??
    (runRow?.startedAt ? Date.now() - runRow.startedAt.getTime() : 0);

  const summary: SessionSummary = {
    outcome,
    durationMs,
    reposTouched: reposTouched.length > 0
      ? reposTouched
      : job.repos?.map((r) => r.repoPath) ?? [],
    prUrls,
    linesAdded,
    linesRemoved,
    toolCallCount: countToolCalls(assistantParts),
    llmCostUsd: runRow?.costUsd ? parseFloat(String(runRow.costUsd)) : 0,
    completedAt: new Date().toISOString(),
  };

  await db
    .update(sessions)
    .set({ summary, linesAdded, linesRemoved, updatedAt: new Date() })
    .where(eq(sessions.id, job.sessionId));
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runAgentTurn(job: AgentJob, redis: Redis, platform: PlatformContainer): Promise<void> {
  const { db, events } = platform;

  // Idempotency guard: skip if run is already terminal or already has work
  const [existingRun] = await db
    .select({ status: agentRuns.status })
    .from(agentRuns)
    .where(eq(agentRuns.id, job.runId))
    .limit(1);

  if (existingRun) {
    const terminalStatuses = new Set(["completed", "aborted", "failed", "error"]);
    if (terminalStatuses.has(existingRun.status)) {
      console.info(`[agent] Skipping already-terminal run ${job.runId} (status=${existingRun.status})`);
      return;
    }

    if (existingRun.status === "running") {
      const [existingMsg] = await db
        .select({ id: chatMessages.id })
        .from(chatMessages)
        .where(eq(chatMessages.runId, job.runId))
        .limit(1);

      if (existingMsg) {
        console.info(`[agent] Skipping duplicate run ${job.runId} (already running with assistant message)`);
        return;
      }
    }
  }

  const adapter = await getAdapter(job.sessionId);
  let summaryParts: AssistantPart[] = [];
  let prMeta = { prUrls: [] as string[], reposTouched: [] as string[], linesAdded: 0, linesRemoved: 0 };

  try {
    await db.update(agentRuns).set({ status: "running", startedAt: new Date() }).where(eq(agentRuns.id, job.runId));
    await events.setKey(`run:${job.runId}:status`, "running", RUN_STATUS_TTL);

    const workspaceSetup = await setupWorkspace({ job, db, adapter, events });

    const llmKeys = await resolveLlmApiKeys(db, job.userId);

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
      { type: "done", assistantMessageId: finalMessageId, assistantParts: assistantParts as unknown[], terminalReason },
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
    // Handle user-initiated abort
    if (error instanceof AbortError) {
      summaryParts = error.parts;
      console.info("[agent] run_terminal", { runId: job.runId, sessionId: job.sessionId, terminalReason: "stopped", status: "aborted" });
      await updateRunStatus(db, job, "aborted", undefined, "stopped");
      await persistSessionSummary({
        db,
        job,
        outcome: "aborted",
        assistantParts: error.parts,
        ...prMeta,
      });
      await publishEvent(events, job.runId, { type: "aborted", terminalReason: "stopped" }, job.requestId);
      await events.setKey(`run:${job.runId}:status`, "aborted", RUN_STATUS_TTL);
      await expireRunStream(redis, job.runId);
      return;
    }

    // Handle turn timeout (native AbortError from fetch/signal)
    if (isTimeoutAbort(error)) {
      console.info("[agent] run_terminal", { runId: job.runId, sessionId: job.sessionId, terminalReason: "timeout", status: "aborted" });
      await updateRunStatus(db, job, "aborted", undefined, "timeout");
      await persistSessionSummary({
        db,
        job,
        outcome: "aborted",
        assistantParts: summaryParts,
        ...prMeta,
      });
      await publishEvent(events, job.runId, { type: "aborted", terminalReason: "timeout" }, job.requestId);
      await events.setKey(`run:${job.runId}:status`, "aborted", RUN_STATUS_TTL);
      await expireRunStream(redis, job.runId);
      return;
    }

    const terminalReason = error instanceof AppError && error.retryable ? "provider_transient" : "internal";
    console.info("[agent] run_terminal", { runId: job.runId, sessionId: job.sessionId, terminalReason, status: "failed", error: error instanceof Error ? error.message : String(error) });
    await updateRunStatus(db, job, "failed", undefined, terminalReason);
    await persistSessionSummary({
      db,
      job,
      outcome: "failed",
      assistantParts: summaryParts,
      ...prMeta,
    });
    await publishEvent(
      events,
      job.runId,
      {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof AppError ? error.code : "INTERNAL_ERROR",
        requestId: job.requestId,
        retryable: error instanceof AppError ? error.retryable : false,
        terminalReason,
      },
      job.requestId,
    );
    await events.setKey(`run:${job.runId}:status`, "failed", RUN_STATUS_TTL);
    await expireRunStream(redis, job.runId);
    throw error;
  } finally {
    await cleanupWorktrees(job, adapter);
  }
}

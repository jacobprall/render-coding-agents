import { eq } from "drizzle-orm";
import { sessions } from "@coding-agents/db";
import { DEFAULT_POLICY, redactCredentials, type PlatformDb, type EventBus } from "@coding-agents/platform";
import type { SandboxAdapter } from "@coding-agents/sandbox";
import { getForgeProviderForSession } from "./providers";
import { publishEvent, evt } from "./run-persistence";
import { shellEscape } from "./lib/shell-escape";
import type { AgentJob } from "./types";

const workspaceReadyCache = new Set<string>();

export function repoNameFromPath(repoPath: string): string {
  return repoPath.split("/").pop() ?? repoPath;
}

async function ensureScratchWorkspace(adapter: SandboxAdapter, userId: string): Promise<void> {
  const scratchId = `scratch/${userId}`;
  await adapter.exec(scratchId, "mkdir -p .").catch(() => {});
  console.log(`[scratch] ensured workspace for user ${userId}`);
}

function redactCloneUrl(text: string): string {
  const withoutUrls = text.replace(/https?:\/\/[^:]+:[^@]+@/g, "https://***:***@");
  return redactCredentials(withoutUrls, DEFAULT_POLICY.credentials);
}

class CloneError extends Error {
  constructor(message: string) {
    super(redactCloneUrl(message));
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

async function sessionWorkspaceHasFiles(adapter: SandboxAdapter, sessionId: string): Promise<boolean> {
  const globResult = await adapter.glob(sessionId, "*").catch(() => ({ files: [] as string[] }));
  return globResult.files.length > 0;
}

/** Keep mirrors fresh between turns without blocking the agent or showing setup UI. */
function refreshMirrorsInBackground(
  adapter: SandboxAdapter,
  job: AgentJob,
  repos: NonNullable<AgentJob["repos"]>,
): void {
  const workspaceId = job.workspaceId ?? job.sessionId;
  for (const repo of repos) {
    void adapter.fetchMirror(job.sessionId, workspaceId, repo.repoPath).catch((err) => {
      console.warn(
        `[mirror] background fetch failed for ${repo.repoPath}:`,
        err instanceof Error ? err.message : err,
      );
    });
  }
}

async function repoDirReady(adapter: SandboxAdapter, sessionId: string, repoName: string): Promise<boolean> {
  const result = await adapter
    .exec(sessionId, `test -e repos/${shellEscape(repoName)}/.git && echo ready`)
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
    `mkdir -p ${shellEscape(cloneDir)} && git clone --depth 50 --branch ${shellEscape(defaultBranch)} ${shellEscape(authenticatedUrl)} ${shellEscape(cloneDir)}`,
  );
  if (shallowResult.exitCode !== 0) {
    const fullResult = await adapter.exec(
      job.sessionId,
      `rm -rf ${shellEscape(cloneDir)} && mkdir -p ${shellEscape(cloneDir)} && git clone --branch ${shellEscape(defaultBranch)} ${shellEscape(authenticatedUrl)} ${shellEscape(cloneDir)}`,
    );
    if (fullResult.exitCode !== 0) {
      throw new CloneError(`Clone failed for ${repoPath}: ${fullResult.stderr}`);
    }
  }

  await adapter.exec(job.sessionId, `git -C ${shellEscape(cloneDir)} remote set-url origin ${shellEscape(plainUrl)}`);
  const checkout = await adapter.exec(job.sessionId, `git -C ${shellEscape(cloneDir)} checkout -b ${shellEscape(branchName)}`);
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
  durationMs: number,
): Promise<void> {
  await publishEvent(
    events,
    job.runId,
    evt("step:completed", {
      stepName: "fallback_clone",
      stepId: "setup",
      durationMs,
      metadata: { degraded: true, repo: repoPath, reason },
    }),
    job.requestId,
  );
}

export async function setupWorkspace(params: {
  job: AgentJob;
  db: PlatformDb;
  adapter: SandboxAdapter;
  events: EventBus;
}): Promise<{ workdir: string; repoCount: number }> {
  const { job, db, adapter, events } = params;
  const sessionId = job.sessionId;

  if (!job.repos?.length) {
    const cacheKey = `scratch:${sessionId}`;
    if (!workspaceReadyCache.has(cacheKey)) {
      const needsSetup = !(await sessionWorkspaceHasFiles(adapter, sessionId));
      if (needsSetup) {
        await publishEvent(events, job.runId, evt("step:started", { stepName: "mirror_check", stepId: "setup" }), job.requestId);
        const cloneStart = Date.now();
        await ensureRepoCloned(db, job, adapter);
        await publishEvent(
          events,
          job.runId,
          evt("step:completed", { stepName: "mirror_check", stepId: "setup", durationMs: Date.now() - cloneStart }),
          job.requestId,
        );
      }
      workspaceReadyCache.add(cacheKey);
    }
    return { workdir: `/workspace/${sessionId}`, repoCount: 1 };
  }

  const repos = job.repos;
  const workspaceId = job.workspaceId ?? sessionId;
  const branchName = job.sessionContext?.branch ?? `agent/${sessionId}`;

  // Check if all repos are cached as ready (skip sandbox calls entirely)
  const allCached = repos.every((r) =>
    workspaceReadyCache.has(`repo:${sessionId}:${repoNameFromPath(r.repoPath)}`),
  );

  if (allCached) {
    refreshMirrorsInBackground(adapter, job, repos);
  } else {
    const allReady = await Promise.all(
      repos.map((repo) => repoDirReady(adapter, sessionId, repoNameFromPath(repo.repoPath))),
    );
    // Cache successful checks
    repos.forEach((repo, i) => {
      if (allReady[i]) {
        workspaceReadyCache.add(`repo:${sessionId}:${repoNameFromPath(repo.repoPath)}`);
      }
    });

    if (allReady.every(Boolean)) {
      refreshMirrorsInBackground(adapter, job, repos);
    } else {
      for (const repo of repos) {
        const repoName = repoNameFromPath(repo.repoPath);
        if (await repoDirReady(adapter, sessionId, repoName)) {
          workspaceReadyCache.add(`repo:${sessionId}:${repoName}`);
          continue;
        }

        const [owner, name] = repo.repoPath.split("/");
        if (!owner || !name) continue;

        const forge = await getForgeProviderForSession(db, {
          forgeType: repo.forgeType ?? "github",
          userId: job.userId,
        });
        const cloneUrl = forge.git.authenticatedCloneUrl(owner, name);

        try {
          await publishEvent(events, job.runId, evt("step:started", { stepName: "mirror_check", stepId: "setup" }), job.requestId);
          const mirrorStart = Date.now();
          const mirror = await adapter.ensureMirror(sessionId, workspaceId, repo.repoPath, cloneUrl);
          await publishEvent(events, job.runId, evt("step:completed", { stepName: "mirror_check", stepId: "setup", durationMs: Date.now() - mirrorStart }), job.requestId);

          if (mirror.status === "error") {
            throw new Error("mirror unavailable");
          }

          await publishEvent(events, job.runId, evt("step:started", { stepName: "worktree_create", stepId: "setup" }), job.requestId);
          const wtStart = Date.now();
          await adapter.createWorktree(sessionId, workspaceId, repo.repoPath, branchName, repo.defaultBranch);
          await publishEvent(events, job.runId, evt("step:completed", { stepName: "worktree_create", stepId: "setup", durationMs: Date.now() - wtStart }), job.requestId);
          console.log(`[worktree] created for ${repo.repoPath} in session ${sessionId}`);
          workspaceReadyCache.add(`repo:${sessionId}:${repoName}`);
        } catch (worktreeErr) {
          const reason = worktreeErr instanceof Error ? worktreeErr.message : "worktree failed";
          console.warn(`[worktree] fallback to clone for ${repo.repoPath}:`, reason);
          try {
            await publishEvent(events, job.runId, evt("step:started", { stepName: "fallback_clone", stepId: "setup" }), job.requestId);
            const fallbackStart = Date.now();
            await cloneRepoIntoSubdir({
              adapter,
              db,
              job,
              repoPath: repo.repoPath,
              defaultBranch: repo.defaultBranch,
              branchName,
            });
            const fallbackDuration = Date.now() - fallbackStart;
            await emitDegradedCloneEvent(events, job, repo.repoPath, reason, fallbackDuration);
            workspaceReadyCache.add(`repo:${sessionId}:${repoName}`);
          } catch (cloneErr) {
            console.error(`[agent] Failed to set up repo ${repo.repoPath}:`, cloneErr);
          }
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

/**
 * Remove per-repo git worktrees for a session. Prefer `cleanupSessionSandbox` on archive/delete
 * (removes the whole workspace). Kept for targeted teardown if needed.
 */
export async function cleanupWorktrees(job: AgentJob, adapter: SandboxAdapter): Promise<void> {
  if (!job.repos?.length) return;
  for (const repo of job.repos) {
    try {
      await adapter.removeWorktree(job.sessionId, repo.repoPath);
    } catch (err) {
      console.warn(`[worktree] cleanup failed for ${repo.repoPath}:`, err instanceof Error ? err.message : err);
    }
  }
}

import { execSync, type ExecSyncOptions } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { WORKSPACE_ROOT } from "../lib/constants";
import { logger } from "../lib/logger";

const MIRRORS_DIR = join(WORKSPACE_ROOT, "mirrors");
const LOCK_TIMEOUT_MS = 30_000;
const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 100;

export interface MirrorInfo {
  status: "ready" | "error" | "initializing";
  path: string;
  sizeBytes: number;
  created: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  durationMs: number;
}

function mirrorPath(workspaceId: string, repoPath: string): string {
  return join(MIRRORS_DIR, workspaceId, `${repoPath}.git`);
}

function worktreePath(sessionId: string, repoPath: string): string {
  const repoName = repoPath.split("/").pop() ?? repoPath;
  return join(WORKSPACE_ROOT, sessionId, "repos", repoName);
}

function lockPath(mirrorDir: string): string {
  return `${mirrorDir}.lock`;
}

function getDirSizeBytes(dir: string): number {
  try {
    const result = execSync(`du -sb "${dir}" 2>/dev/null || echo "0"`, {
      encoding: "utf-8",
      timeout: 10_000,
    });
    return parseInt(result.split("\t")[0] ?? "0", 10);
  } catch {
    return 0;
  }
}

function withLock<T>(lockFile: string, fn: () => T): T {
  mkdirSync(dirname(lockFile), { recursive: true });
  const start = Date.now();
  while (true) {
    try {
      mkdirSync(lockFile);
      break;
    } catch {
      if (Date.now() - start >= LOCK_TIMEOUT_MS) {
        throw new Error(`Lock timeout: ${lockFile}`);
      }
      Bun.sleepSync(RETRY_DELAY_MS);
    }
  }

  try {
    return fn();
  } finally {
    try {
      rmSync(lockFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

const gitExecOpts: ExecSyncOptions = {
  encoding: "utf-8" as BufferEncoding,
  timeout: 300_000,
  stdio: ["pipe", "pipe", "pipe"],
};

function checkMirrorHealth(mirrorDir: string): boolean {
  try {
    execSync(`git -C "${mirrorDir}" fsck --no-full --no-progress`, {
      ...gitExecOpts,
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
}

type MirrorLogFields = {
  workspaceId?: string;
  repoPath?: string;
  sessionId?: string;
  durationMs?: number;
  error?: string;
};

function logMirror(
  level: "info" | "warn" | "error",
  event: string,
  fields: MirrorLogFields & Record<string, unknown> = {},
): void {
  logger[level](event, { event, ...fields });
}

export function ensureMirror(
  workspaceId: string,
  repoPath: string,
  cloneUrl: string,
): MirrorInfo {
  const mp = mirrorPath(workspaceId, repoPath);
  const lock = lockPath(mp);
  const start = Date.now();

  return withLock(lock, () => {
    if (existsSync(join(mp, "HEAD"))) {
      if (!checkMirrorHealth(mp)) {
        logMirror("warn", "ensure_mirror_corrupted", { workspaceId, repoPath });
        try {
          rmSync(mp, { recursive: true, force: true });
        } catch {
          // best effort
        }
      } else {
        const fetchStart = Date.now();
        try {
          execSync(`git -C "${mp}" fetch --all --prune`, gitExecOpts);
          logMirror("info", "ensure_mirror_fetch_success", {
            workspaceId,
            repoPath,
            durationMs: Date.now() - fetchStart,
          });
        } catch (err) {
          logMirror("warn", "ensure_mirror_fetch_failed", {
            workspaceId,
            repoPath,
            durationMs: Date.now() - fetchStart,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        logMirror("info", "ensure_mirror_success", {
          workspaceId,
          repoPath,
          durationMs: Date.now() - start,
          created: false,
        });
        return {
          status: "ready",
          path: mp,
          sizeBytes: getDirSizeBytes(mp),
          created: false,
        };
      }
    }

    mkdirSync(dirname(mp), { recursive: true });
    const cloneStart = Date.now();
    try {
      execSync(`git clone --bare --no-tags "${cloneUrl}" "${mp}"`, gitExecOpts);
      execSync(`git -C "${mp}" config gc.auto 0`, gitExecOpts);
      logMirror("info", "ensure_mirror_clone_success", {
        workspaceId,
        repoPath,
        durationMs: Date.now() - cloneStart,
      });
      logMirror("info", "ensure_mirror_success", {
        workspaceId,
        repoPath,
        durationMs: Date.now() - start,
        created: true,
      });
      return {
        status: "ready",
        path: mp,
        sizeBytes: getDirSizeBytes(mp),
        created: true,
      };
    } catch (err) {
      logMirror("error", "ensure_mirror_failed", {
        workspaceId,
        repoPath,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: "error", path: mp, sizeBytes: 0, created: false };
    }
  });
}

export function fetchMirror(
  workspaceId: string,
  repoPath: string,
): { status: "success" | "failed"; durationMs: number; newCommits: number } {
  const mp = mirrorPath(workspaceId, repoPath);
  const lock = lockPath(mp);
  const start = Date.now();

  if (!existsSync(join(mp, "HEAD"))) {
    const durationMs = Date.now() - start;
    logMirror("warn", "fetch_mirror_failed", {
      workspaceId,
      repoPath,
      durationMs,
      error: "Mirror not found",
    });
    return { status: "failed", durationMs, newCommits: 0 };
  }

  return withLock(lock, () => {
    try {
      const before = execSync(`git -C "${mp}" rev-parse HEAD`, gitExecOpts).toString().trim();
      execSync(`git -C "${mp}" fetch --all --prune`, gitExecOpts);
      const after = execSync(`git -C "${mp}" rev-parse HEAD`, gitExecOpts).toString().trim();
      const newCommits = before !== after ? 1 : 0;
      const durationMs = Date.now() - start;
      logMirror("info", "fetch_mirror_success", {
        workspaceId,
        repoPath,
        durationMs,
        newCommits,
      });
      return { status: "success" as const, durationMs, newCommits };
    } catch (err) {
      const durationMs = Date.now() - start;
      logMirror("warn", "fetch_mirror_failed", {
        workspaceId,
        repoPath,
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
      return { status: "failed" as const, durationMs, newCommits: 0 };
    }
  });
}

export function createWorktree(params: {
  workspaceId: string;
  sessionId: string;
  repoPath: string;
  branchName: string;
  baseBranch: string;
}): WorktreeInfo {
  const { workspaceId, sessionId, repoPath, branchName, baseBranch } = params;
  // Branch naming agent/{sessionId} ensures uniqueness across concurrent sessions.
  // withLock() provides mutual exclusion for worktree add operations on the same mirror.
  const mp = mirrorPath(workspaceId, repoPath);
  const wt = worktreePath(sessionId, repoPath);
  const lock = lockPath(mp);
  const start = Date.now();

  if (!existsSync(join(mp, "HEAD"))) {
    const error = `Mirror not found: ${mp}`;
    logMirror("error", "create_worktree_failed", {
      workspaceId,
      repoPath,
      sessionId,
      durationMs: Date.now() - start,
      error,
    });
    throw new Error(error);
  }

  mkdirSync(dirname(wt), { recursive: true });

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    try {
      return withLock(lock, () => {
        execSync(
          `git -C "${mp}" worktree add -b "${branchName}" "${wt}" "origin/${baseBranch}"`,
          gitExecOpts,
        );
        const durationMs = Date.now() - start;
        logMirror("info", "create_worktree_success", {
          workspaceId,
          repoPath,
          sessionId,
          durationMs,
          branch: branchName,
        });
        return {
          path: wt,
          branch: branchName,
          durationMs,
        };
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < RETRY_COUNT - 1) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
        Bun.sleepSync(delay);
      }
    }
  }

  logMirror("error", "create_worktree_failed", {
    workspaceId,
    repoPath,
    sessionId,
    durationMs: Date.now() - start,
    error: lastError?.message ?? "Failed to create worktree",
  });
  throw lastError ?? new Error("Failed to create worktree");
}

export function removeWorktree(sessionId: string, repoPath: string): boolean {
  const wt = worktreePath(sessionId, repoPath);
  const start = Date.now();
  try {
    if (existsSync(wt)) {
      execSync(`git worktree remove --force "${wt}"`, {
        ...gitExecOpts,
        timeout: 30_000,
      });
    }
    logMirror("info", "remove_worktree_success", {
      sessionId,
      repoPath,
      durationMs: Date.now() - start,
    });
    return true;
  } catch (err) {
    logMirror("warn", "remove_worktree_failed", {
      sessionId,
      repoPath,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export function listMirrors(): Array<{
  workspaceId: string;
  repoPath: string;
  path: string;
  sizeBytes: number;
  lastAccessedMs: number;
}> {
  if (!existsSync(MIRRORS_DIR)) return [];

  const results: Array<{
    workspaceId: string;
    repoPath: string;
    path: string;
    sizeBytes: number;
    lastAccessedMs: number;
  }> = [];

  try {
    for (const wsDir of readdirSync(MIRRORS_DIR)) {
      const wsPath = join(MIRRORS_DIR, wsDir);
      const stat = statSync(wsPath);
      if (!stat.isDirectory()) continue;

      for (const orgDir of readdirSync(wsPath)) {
        const orgPath = join(wsPath, orgDir);
        if (!statSync(orgPath).isDirectory()) continue;

        for (const repoDir of readdirSync(orgPath)) {
          if (!repoDir.endsWith(".git")) continue;
          const fullPath = join(orgPath, repoDir);
          const repoName = repoDir.replace(/\.git$/, "");
          results.push({
            workspaceId: wsDir,
            repoPath: `${orgDir}/${repoName}`,
            path: fullPath,
            sizeBytes: getDirSizeBytes(fullPath),
            lastAccessedMs: statSync(fullPath).atimeMs,
          });
        }
      }
    }
  } catch (err) {
    logMirror("warn", "list_mirrors_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return results;
}

export function removeMirror(workspaceId: string, repoPath: string): boolean {
  const mp = mirrorPath(workspaceId, repoPath);
  try {
    if (existsSync(mp)) {
      execSync(`rm -rf "${mp}"`, { timeout: 30_000 });
      const lockFile = lockPath(mp);
      if (existsSync(lockFile)) unlinkSync(lockFile);
    }
    return true;
  } catch {
    return false;
  }
}

const SYNC_INTERVAL_MS = parseInt(
  process.env.MIRROR_IDLE_SYNC_INTERVAL_MS ?? String(24 * 60 * 60 * 1000),
  10,
); // default 24h

export function startPeriodicSync(): void {
  console.info(`[mirror] periodic sync configured with interval=${SYNC_INTERVAL_MS}ms`);
  setInterval(() => {
    const mirrors = listMirrors();
    console.info(`[mirror] periodic sync tick: ${mirrors.length} mirror(s) to refresh`);
    for (const mirror of mirrors) {
      try {
        fetchMirror(mirror.workspaceId, mirror.repoPath);
      } catch (err) {
        logMirror("warn", "periodic_sync_failed", {
          workspaceId: mirror.workspaceId,
          repoPath: mirror.repoPath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, SYNC_INTERVAL_MS);
}

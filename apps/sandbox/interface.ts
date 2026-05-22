import type {
  ExecResult,
  FileReadResult,
  GlobResult,
  GrepResult,
  GitResult,
  SnapshotResult,
  VerifyCheck,
  VerifyResult,
} from "./types";

export interface SandboxAdapter {
  exec(sessionId: string, command: string, timeoutMs?: number): Promise<ExecResult>;
  readFile(sessionId: string, path: string): Promise<FileReadResult>;
  writeFile(sessionId: string, path: string, content: string): Promise<void>;
  glob(sessionId: string, pattern: string): Promise<GlobResult>;
  grep(sessionId: string, pattern: string, path?: string): Promise<GrepResult>;
  git(sessionId: string, args: string[]): Promise<GitResult>;
  snapshot(sessionId: string, snapshotId: string): Promise<SnapshotResult>;
  restore(sessionId: string, snapshotId: string): Promise<void>;
  cloneWorkspace(fromSessionId: string, toSessionId: string): Promise<void>;
  verify(sessionId: string, checks: VerifyCheck[]): Promise<VerifyResult[]>;
  cleanup(sessionId: string): Promise<void>;
  ensureMirror(
    sessionId: string,
    workspaceId: string,
    repoPath: string,
    cloneUrl: string,
  ): Promise<{ status: string; path: string; sizeBytes: number; created: boolean }>;
  fetchMirror(
    sessionId: string,
    workspaceId: string,
    repoPath: string,
  ): Promise<{ status: string; durationMs: number; newCommits: number }>;
  createWorktree(
    sessionId: string,
    workspaceId: string,
    repoPath: string,
    branchName: string,
    baseBranch: string,
  ): Promise<{ path: string; branch: string; durationMs: number }>;
  removeWorktree(sessionId: string, repoPath: string): Promise<{ removed: boolean }>;
  getDiskStatus(sessionId: string): Promise<{
    totalBytes: number;
    usedBytes: number;
    mirrorBytes: number;
    usagePercent: number;
    mirrorCount: number;
    worktreeCount: number;
  }>;
}

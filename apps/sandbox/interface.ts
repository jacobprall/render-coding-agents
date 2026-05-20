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
}

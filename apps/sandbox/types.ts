export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

export interface FileReadResult {
  content: string;
  exists: boolean;
  errorCode?: "not_found" | "too_large" | "read_failed";
  errorMessage?: string;
}

export interface GlobResult {
  files: string[];
  /** True when the server hit the max result cap and may have omitted matches */
  truncated?: boolean;
}

export interface GrepResult {
  matches: GrepMatch[];
}

export interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SnapshotResult {
  snapshotId: string;
  sizeBytes: number;
}

export interface VerifyCheck {
  name: string;
  command: string;
  timeoutMs?: number;
}

export interface VerifyResult {
  name: string;
  status: "pass" | "fail" | "error" | "timeout";
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface HealthResult {
  status: "ok";
  diskUsage: {
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
    percentUsed: number;
  };
}

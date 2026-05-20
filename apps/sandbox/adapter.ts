import { mintSandboxSessionToken } from "./session-token";
import type { SandboxAdapter } from "./interface";
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

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const EXEC_REQUEST_TIMEOUT_MS = 600_000;

export interface SandboxSessionAuth {
  secret: string;
  userId: string;
}

export class HttpSandboxAdapter implements SandboxAdapter {
  constructor(
    private host: string,
    private sharedSecret?: string,
    private sessionAuth?: SandboxSessionAuth,
  ) {}

  private get authHeaders(): Record<string, string> {
    return this.sharedSecret ? { Authorization: `Bearer ${this.sharedSecret}` } : {};
  }

  private sessionHeaders(sessionId: string): Record<string, string> {
    if (!this.sessionAuth) return {};
    const token = mintSandboxSessionToken({
      sessionId,
      userId: this.sessionAuth.userId,
      secret: this.sessionAuth.secret,
    });
    return { "X-Sandbox-Session-Token": token };
  }

  private async request<T>(
    path: string,
    sessionId: string,
    body: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`http://${this.host}${path}`, {
        method: "POST",
        headers: {
          "X-Session-Id": sessionId,
          "Content-Type": "application/json",
          ...this.authHeaders,
          ...this.sessionHeaders(sessionId),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(
        `Sandbox unreachable: ${err instanceof Error ? err.message : "network error"}`,
        { cause: err },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`Sandbox request failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async exec(sessionId: string, command: string, timeoutMs?: number): Promise<ExecResult> {
    return this.request<ExecResult>("/exec", sessionId, { command, timeoutMs }, EXEC_REQUEST_TIMEOUT_MS);
  }

  async readFile(sessionId: string, path: string): Promise<FileReadResult> {
    return this.request<FileReadResult>("/read", sessionId, { path });
  }

  async writeFile(sessionId: string, path: string, content: string): Promise<void> {
    await this.request("/write", sessionId, { path, content });
  }

  async glob(sessionId: string, pattern: string): Promise<GlobResult> {
    return this.request<GlobResult>("/glob", sessionId, { pattern });
  }

  async grep(sessionId: string, pattern: string, path?: string): Promise<GrepResult> {
    return this.request<GrepResult>("/grep", sessionId, { pattern, path });
  }

  async git(sessionId: string, args: string[]): Promise<GitResult> {
    return this.request<GitResult>("/git", sessionId, { args });
  }

  async snapshot(sessionId: string, snapshotId: string): Promise<SnapshotResult> {
    const res = await fetch(`http://${this.host}/snapshot/${snapshotId}`, {
      method: "POST",
      headers: {
        "X-Session-Id": sessionId,
        ...this.authHeaders,
        ...this.sessionHeaders(sessionId),
      },
      signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Snapshot failed: ${res.status}`);
    return res.json() as Promise<SnapshotResult>;
  }

  async restore(sessionId: string, snapshotId: string): Promise<void> {
    const res = await fetch(`http://${this.host}/restore/${snapshotId}`, {
      method: "POST",
      headers: {
        "X-Session-Id": sessionId,
        ...this.authHeaders,
        ...this.sessionHeaders(sessionId),
      },
      signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Restore failed: ${res.status}`);
  }

  async cloneWorkspace(fromSessionId: string, toSessionId: string): Promise<void> {
    const res = await fetch(`http://${this.host}/clone-workspace`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": toSessionId,
        ...this.authHeaders,
        ...this.sessionHeaders(toSessionId),
      },
      body: JSON.stringify({ fromSessionId, toSessionId }),
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`cloneWorkspace failed (${res.status}): ${text}`);
    }
  }

  async verify(sessionId: string, checks: VerifyCheck[]): Promise<VerifyResult[]> {
    return this.request<VerifyResult[]>("/verify", sessionId, { checks }, EXEC_REQUEST_TIMEOUT_MS);
  }
}

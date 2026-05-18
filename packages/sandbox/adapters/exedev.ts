/**
 * SandboxAdapter implementation for exe.dev VMs.
 *
 * Every operation is executed over SSH to `vmHost` (e.g. "myvm.exe.xyz").
 * The workspace root on the VM defaults to /home/exedev/workspace, with each
 * session getting its own subdirectory.
 */

import path from "node:path";

import type { SandboxAdapter } from "../interface";
import type {
  ExecResult,
  FileReadResult,
  GlobResult,
  GrepResult,
  GrepMatch,
  GitResult,
  SnapshotResult,
  VerifyCheck,
  VerifyResult,
} from "../types";
import { sshExec as defaultSshExec, type SshExecOptions } from "../lib/exedev-ssh";

const DEFAULT_EXEC_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_GLOB_RESULTS = 10_000;

function shellEscape(str: string): string {
  return str.replace(/'/g, "'\\''");
}

export type SshExecFn = (
  vmHost: string,
  command: string,
  opts?: SshExecOptions & { sshKeyPath?: string },
) => Promise<ExecResult>;

export interface ExeDevAdapterOptions {
  /** SSH hostname, e.g. "myvm.exe.xyz" */
  vmHost: string;
  /** Workspace root on the VM. Defaults to "/home/exedev/workspace". */
  workspaceRoot?: string;
  /** Path to SSH private key for connecting to the VM. */
  sshKeyPath?: string;
  /** Injectable SSH executor for testing. Defaults to real SSH. */
  sshExecFn?: SshExecFn;
}

export class ExeDevSandboxAdapter implements SandboxAdapter {
  private readonly vmHost: string;
  private readonly workspaceRoot: string;
  private readonly sshKeyPath?: string;
  private readonly sshExecFn: SshExecFn;

  constructor(opts: ExeDevAdapterOptions) {
    this.vmHost = opts.vmHost;
    this.workspaceRoot = opts.workspaceRoot ?? "/home/exedev/workspace";
    this.sshKeyPath = opts.sshKeyPath;
    this.sshExecFn = opts.sshExecFn ?? defaultSshExec;
  }

  private sessionCwd(sessionId: string): string {
    return `${this.workspaceRoot}/${sessionId}`;
  }

  private sshOpts(sessionId: string, timeoutMs?: number) {
    return {
      cwd: this.sessionCwd(sessionId),
      sshKeyPath: this.sshKeyPath,
      timeoutMs,
    };
  }

  async exec(sessionId: string, command: string, timeoutMs?: number): Promise<ExecResult> {
    return this.sshExecFn(this.vmHost, command, this.sshOpts(sessionId, timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS));
  }

  async readFile(sessionId: string, path: string): Promise<FileReadResult> {
    const absPath = this.resolvePath(sessionId, path);
    const escPath = shellEscape(absPath);
    const sizeCheck = await this.sshExecFn(
      this.vmHost,
      `stat -c '%s' '${escPath}' 2>/dev/null || echo '-1'`,
      { sshKeyPath: this.sshKeyPath, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS },
    );

    const size = parseInt(sizeCheck.stdout.trim(), 10);
    if (size < 0 || sizeCheck.exitCode !== 0) {
      return { content: "", exists: false, errorCode: "not_found", errorMessage: "File not found" };
    }
    if (size > MAX_READ_BYTES) {
      return { content: "", exists: true, errorCode: "too_large", errorMessage: `File exceeds ${MAX_READ_BYTES} bytes` };
    }

    const result = await this.sshExecFn(
      this.vmHost,
      `cat '${escPath}'`,
      { sshKeyPath: this.sshKeyPath, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS },
    );

    if (result.exitCode !== 0) {
      return { content: "", exists: false, errorCode: "read_failed", errorMessage: result.stderr.trim() };
    }
    return { content: result.stdout, exists: true };
  }

  async writeFile(sessionId: string, path: string, content: string): Promise<void> {
    const absPath = this.resolvePath(sessionId, path);
    const dir = absPath.substring(0, absPath.lastIndexOf("/"));

    const result = await this.sshExecFn(
      this.vmHost,
      `mkdir -p '${shellEscape(dir)}' && cat > '${shellEscape(absPath)}'`,
      { sshKeyPath: this.sshKeyPath, stdin: content, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS },
    );

    if (result.exitCode !== 0) {
      throw new Error(`writeFile failed: ${result.stderr.trim()}`);
    }
  }

  async glob(sessionId: string, pattern: string): Promise<GlobResult> {
    const escPattern = shellEscape(pattern);
    const cmd = `find . -path './${escPattern}' -o -name '${escPattern}' 2>/dev/null | head -n ${MAX_GLOB_RESULTS + 1}`;

    const result = await this.sshExecFn(this.vmHost, cmd, this.sshOpts(sessionId, DEFAULT_REQUEST_TIMEOUT_MS));

    const files = result.stdout
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => (f.startsWith("./") ? f.slice(2) : f));

    const truncated = files.length > MAX_GLOB_RESULTS;
    return { files: files.slice(0, MAX_GLOB_RESULTS), truncated };
  }

  async grep(sessionId: string, pattern: string, path?: string): Promise<GrepResult> {
    const target = path === undefined ? "." : this.resolvePath(sessionId, path);
    const cmd = `rg --json -m 200 '${shellEscape(pattern)}' '${shellEscape(target)}' 2>/dev/null || true`;

    const result = await this.sshExecFn(this.vmHost, cmd, this.sshOpts(sessionId, DEFAULT_REQUEST_TIMEOUT_MS));

    const matches: GrepMatch[] = [];
    for (const line of result.stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as { type: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
        if (obj.type === "match" && obj.data) {
          matches.push({
            file: obj.data.path?.text ?? "",
            line: obj.data.line_number ?? 0,
            content: obj.data.lines?.text?.trimEnd() ?? "",
          });
        }
      } catch {
        // skip non-JSON lines
      }
    }

    return { matches };
  }

  async git(sessionId: string, args: string[]): Promise<GitResult> {
    const escaped = args.map((a) => `'${shellEscape(a)}'`).join(" ");
    const result = await this.sshExecFn(
      this.vmHost,
      `git ${escaped}`,
      this.sshOpts(sessionId, 60_000),
    );

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  private validateSnapshotId(snapshotId: string): void {
    if (!snapshotId || /[\/\\\0]/.test(snapshotId) || snapshotId === "." || snapshotId === "..") {
      throw new Error("Invalid snapshot ID");
    }
  }

  async snapshot(sessionId: string, snapshotId: string): Promise<SnapshotResult> {
    this.validateSnapshotId(snapshotId);
    const cwd = this.sessionCwd(sessionId);
    const snapshotDir = `${this.workspaceRoot}/.snapshots`;
    const tarPath = `${snapshotDir}/${snapshotId}.tar.gz`;

    const result = await this.sshExecFn(
      this.vmHost,
      `mkdir -p '${shellEscape(snapshotDir)}' && tar czf '${shellEscape(tarPath)}' -C '${shellEscape(cwd)}' . && stat -c '%s' '${shellEscape(tarPath)}'`,
      { sshKeyPath: this.sshKeyPath, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS },
    );

    if (result.exitCode !== 0) {
      throw new Error(`snapshot failed: ${result.stderr.trim()}`);
    }

    const sizeBytes = parseInt(result.stdout.trim().split("\n").pop() ?? "0", 10);
    return { snapshotId, sizeBytes };
  }

  async restore(sessionId: string, snapshotId: string): Promise<void> {
    this.validateSnapshotId(snapshotId);
    const cwd = this.sessionCwd(sessionId);
    const tarPath = `${this.workspaceRoot}/.snapshots/${snapshotId}.tar.gz`;

    const result = await this.sshExecFn(
      this.vmHost,
      `rm -rf '${shellEscape(cwd)}' && mkdir -p '${shellEscape(cwd)}' && tar xzf '${shellEscape(tarPath)}' -C '${shellEscape(cwd)}'`,
      { sshKeyPath: this.sshKeyPath, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS },
    );

    if (result.exitCode !== 0) {
      throw new Error(`restore failed: ${result.stderr.trim()}`);
    }
  }

  async cloneWorkspace(fromSessionId: string, toSessionId: string): Promise<void> {
    const fromDir = this.sessionCwd(fromSessionId);
    const toDir = this.sessionCwd(toSessionId);

    const result = await this.sshExecFn(
      this.vmHost,
      `rm -rf '${shellEscape(toDir)}' && cp -a '${shellEscape(fromDir)}' '${shellEscape(toDir)}'`,
      { sshKeyPath: this.sshKeyPath, timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS },
    );

    if (result.exitCode !== 0) {
      throw new Error(`cloneWorkspace failed: ${result.stderr.trim()}`);
    }
  }

  async verify(sessionId: string, checks: VerifyCheck[]): Promise<VerifyResult[]> {
    const results: VerifyResult[] = [];

    for (const check of checks) {
      const timeoutMs = check.timeoutMs ?? 120_000;
      const result = await this.sshExecFn(
        this.vmHost,
        check.command,
        this.sshOpts(sessionId, timeoutMs),
      );

      let status: VerifyResult["status"] = "pass";
      if (result.timedOut) status = "timeout";
      else if (result.exitCode !== 0) status = "fail";

      results.push({
        name: check.name,
        status,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
      });
    }

    return results;
  }

  private resolvePath(sessionId: string, userPath: string): string {
    const sessionRoot = path.posix.normalize(this.sessionCwd(sessionId));
    const resolved = path.posix.resolve(sessionRoot, userPath);
    const prefix = sessionRoot.endsWith("/") ? sessionRoot : `${sessionRoot}/`;
    if (resolved !== sessionRoot && !resolved.startsWith(prefix)) {
      throw new Error("Path escapes session workspace");
    }
    return resolved;
  }
}

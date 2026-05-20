/**
 * Low-level SSH execution helpers for exe.dev VMs.
 *
 * All sandbox operations (exec, file I/O, git, etc.) are translated to
 * SSH commands against `vmname.exe.xyz`. We use child_process.spawn for
 * proper stream handling, timeouts, and stdin piping.
 */

import { spawn } from "node:child_process";
import type { ExecResult } from "../types";

const DEFAULT_SSH_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

export interface SshExecOptions {
  timeoutMs?: number;
  /** Data to pipe to stdin of the remote command. */
  stdin?: string | Buffer;
  /** Working directory on the remote VM. */
  cwd?: string;
  /** Extra environment variables to set on the remote side. */
  env?: Record<string, string>;
}

function buildSshArgs(vmHost: string, sshKeyPath?: string): string[] {
  const args = [
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=4",
    "-o", "BatchMode=yes",
  ];
  if (sshKeyPath) {
    args.push("-i", sshKeyPath);
  }
  args.push(vmHost);
  return args;
}

function wrapRemoteCommand(command: string, opts?: SshExecOptions): string {
  const parts: string[] = [];

  if (opts?.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      const escaped = v.replace(/'/g, "'\\''");
      parts.push(`export ${k}='${escaped}'`);
    }
  }

  if (opts?.cwd) {
    const escapedCwd = opts.cwd.replace(/'/g, "'\\''");
    parts.push(`cd '${escapedCwd}' 2>/dev/null || mkdir -p '${escapedCwd}' && cd '${escapedCwd}'`);
  }

  parts.push(command);
  return parts.join(" && ");
}

/**
 * Execute a command on a remote exe.dev VM via SSH.
 */
export function sshExec(
  vmHost: string,
  command: string,
  opts?: SshExecOptions & { sshKeyPath?: string },
): Promise<ExecResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_SSH_TIMEOUT_MS;
  const sshArgs = buildSshArgs(vmHost, opts?.sshKeyPath);
  const remoteCmd = wrapRemoteCommand(command, opts);
  sshArgs.push(remoteCmd);

  return new Promise((resolve) => {
    const start = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let timedOut = false;
    let settled = false;

    const proc = spawn("ssh", sshArgs, { stdio: ["pipe", "pipe", "pipe"] });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => {
      if (stdoutLen < MAX_OUTPUT_BYTES) {
        stdoutChunks.push(chunk);
        stdoutLen += chunk.length;
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      if (stderrLen < MAX_OUTPUT_BYTES) {
        stderrChunks.push(chunk);
        stderrLen += chunk.length;
      }
    });

    if (opts?.stdin != null) {
      proc.stdin.write(opts.stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    function finish(exitCode: number | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8").slice(0, MAX_OUTPUT_BYTES),
        stderr: Buffer.concat(stderrChunks).toString("utf8").slice(0, MAX_OUTPUT_BYTES),
        exitCode: exitCode ?? 1,
        timedOut,
        durationMs: Date.now() - start,
      });
    }

    proc.on("close", (code) => finish(code));
    proc.on("error", () => finish(1));
  });
}

/**
 * Execute an exe.dev management command via SSH (e.g., `new`, `rm`, `ls`).
 */
export function sshExeDevCmd(
  command: string,
  opts?: { sshKeyPath?: string; timeoutMs?: number },
): Promise<ExecResult> {
  const args = buildSshArgs("exe.dev", opts?.sshKeyPath);
  args.push(`${command} --json`);
  const timeoutMs = opts?.timeoutMs ?? 30_000;

  return new Promise((resolve) => {
    const start = Date.now();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;

    const proc = spawn("ssh", args, { stdio: ["pipe", "pipe", "pipe"] });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, timeoutMs);

    proc.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    proc.stdin.end();

    function finish(exitCode: number | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        exitCode: exitCode ?? 1,
        timedOut,
        durationMs: Date.now() - start,
      });
    }

    proc.on("close", (code) => finish(code));
    proc.on("error", () => finish(1));
  });
}

/**
 * Execute an exe.dev management command via the HTTPS API.
 * Used for short management operations (new, rm, ls, stat).
 */
export async function httpsExeDevCmd(
  command: string,
  bearerToken: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch("https://exe.dev/exec", {
    method: "POST",
    headers: {
      "X-Exedev-Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "text/plain",
    },
    body: command,
    signal: AbortSignal.timeout(25_000),
  });

  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

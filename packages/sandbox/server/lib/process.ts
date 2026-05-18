import { existsSync, mkdirSync } from "node:fs";
import type { Subprocess } from "bun";
import type { ExecResult } from "../../types";
import { ALLOWED_ENV_KEYS, DEFAULT_EXEC_TIMEOUT_MS, MAX_OUTPUT_BYTES } from "./constants";

const SETSID_BIN = "/usr/bin/setsid";

async function readBounded(stream: ReadableStream<Uint8Array> | null | undefined, maxBytes: number): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (totalLen < maxBytes) {
        const remaining = maxBytes - totalLen;
        if (value.length <= remaining) {
          chunks.push(value);
          totalLen += value.length;
        } else {
          chunks.push(value.subarray(0, remaining));
          totalLen = maxBytes;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export function killProcTree(proc: Subprocess): void {
  const pid = proc.pid;
  if (typeof pid === "number" && pid > 0) {
    try {
      process.kill(-pid, "SIGKILL");
      return;
    } catch {
      // fall through
    }
  }
  try {
    proc.kill("SIGKILL");
  } catch {
    // ignore
  }
}

/** Allowlisted env propagated to spawned children */
export function childProcessEnv(extra?: Record<string, string>): Record<string, string> & NodeJS.ProcessEnv {
  const out: Record<string, string> = {};
  for (const k of ALLOWED_ENV_KEYS) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (ALLOWED_ENV_KEYS.has(k)) out[k] = v;
    }
  }
  return out as Record<string, string> & NodeJS.ProcessEnv;
}

/** Minimal shell splitter for verify single-string commands — not full POSIX quoting */
export function parseShellCommand(cmd: string): string[] {
  const trimmed = cmd.trim();
  if (!trimmed) return [];

  const out: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c as "'" | '"';
      continue;
    }
    if (/\s/.test(c)) {
      if (cur) {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

export async function runArgv(
  argv: string[],
  cwd: string,
  timeoutMs = DEFAULT_EXEC_TIMEOUT_MS,
  extraEnv?: Record<string, string>,
): Promise<ExecResult> {
  const start = Date.now();
  if (argv.length === 0) {
    return { stdout: "", stderr: "empty command", exitCode: 1, timedOut: false, durationMs: 0 };
  }

  mkdirSync(cwd, { recursive: true });

  const proc = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: childProcessEnv(extraEnv),
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcTree(proc);
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    readBounded(proc.stdout, MAX_OUTPUT_BYTES),
    readBounded(proc.stderr, MAX_OUTPUT_BYTES),
    proc.exited,
  ]);

  clearTimeout(timer);

  return { stdout, stderr, exitCode: exitCode ?? 1, timedOut, durationMs: Date.now() - start };
}

function shellSpawnArgv(wrapped: string): string[] {
  if (existsSync(SETSID_BIN)) {
    return [SETSID_BIN, "bash", "-lc", wrapped];
  }
  return ["bash", "-lc", wrapped];
}

export async function runCommand(
  command: string,
  cwd: string,
  timeoutMs = DEFAULT_EXEC_TIMEOUT_MS,
  env?: Record<string, string>,
): Promise<ExecResult> {
  const start = Date.now();
  mkdirSync(cwd, { recursive: true });

  const wrapped = `ulimit -u 256 2>/dev/null || true; ulimit -v 2097152 2>/dev/null || true; ${command}`;
  const argv = shellSpawnArgv(wrapped);

  const proc = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: childProcessEnv(env),
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcTree(proc);
  }, timeoutMs);

  const [stdout, stderr, exitCode] = await Promise.all([
    readBounded(proc.stdout, MAX_OUTPUT_BYTES),
    readBounded(proc.stderr, MAX_OUTPUT_BYTES),
    proc.exited,
  ]);

  clearTimeout(timer);

  return { stdout, stderr, exitCode: exitCode ?? 1, timedOut, durationMs: Date.now() - start };
}

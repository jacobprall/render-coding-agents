import type { ExecResult, VerifyCheck, VerifyResult } from "../../types";
import { DEFAULT_VERIFY_TIMEOUT_MS } from "../lib/constants";
import { getSessionWorkspace, getSessionId } from "../lib/path-security";
import { parseShellCommand, runArgv, runCommand } from "../lib/process";

export async function handleVerify(req: Request, body: Record<string, unknown>): Promise<Response> {
  const sessionId = getSessionId(req);
  const rawChecks = body.checks;
  const checks =
    Array.isArray(rawChecks) && rawChecks.every((c): c is VerifyCheck => isVerifyCheck(c))
      ? rawChecks
      : [];

  const cwd = getSessionWorkspace(sessionId);
  const results: VerifyResult[] = [];

  for (const check of checks) {
    const timeoutMs = check.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
    const needsShell = /[|&;<>$`\n\\]/.test(check.command);

    let result: ExecResult;
    if (needsShell) {
      result = await runCommand(check.command, cwd, timeoutMs);
    } else {
      const argv = parseShellCommand(check.command);
      result =
        argv.length > 0
          ? await runArgv(argv, cwd, timeoutMs)
          : await runCommand(check.command, cwd, timeoutMs);
    }

    let status: VerifyResult["status"];
    if (result.timedOut) {
      status = "timeout";
    } else if (result.exitCode === 0) {
      status = "pass";
    } else {
      status = "fail";
    }

    results.push({
      name: check.name,
      status,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
    });
  }

  return Response.json(results);
}

function isVerifyCheck(x: unknown): x is VerifyCheck {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.name === "string" && typeof o.command === "string";
}

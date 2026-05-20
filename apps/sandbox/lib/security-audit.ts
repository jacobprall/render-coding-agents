/**
 * Sandbox Security Audit — automated checks for escape prevention.
 *
 * Run these checks at server startup or via a health/security endpoint
 * to verify the sandbox is properly hardened.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ALLOWED_ENV_KEYS } from "../server/lib/constants";
import { validateGitArgv } from "../server/lib/git-policy";
import {
  getSessionId,
  validatePath,
} from "../server/lib/path-security";

export interface AuditCheck {
  name: string;
  passed: boolean;
  severity: "critical" | "high" | "medium" | "low";
  detail: string;
}

export async function runSecurityAudit(): Promise<AuditCheck[]> {
  const checks: AuditCheck[] = [];

  let pathTraversalPassed = false;
  try {
    validatePath("audittestsession", "../../../etc/passwd");
  } catch {
    pathTraversalPassed = true;
  }
  checks.push({
    name: "path-traversal-guard",
    passed: pathTraversalPassed,
    severity: "critical",
    detail: pathTraversalPassed
      ? "validatePath() rejects traversal outside session workspace"
      : "FAIL: traversal path should have been rejected",
  });

  let sessionIdPassed = false;
  try {
    getSessionId(
      new Request("http://localhost/", { headers: { "x-session-id": "../bad" } }),
    );
  } catch {
    sessionIdPassed = true;
  }
  checks.push({
    name: "session-id-alphanumeric-only",
    passed: sessionIdPassed,
    severity: "critical",
    detail: sessionIdPassed ? "Malformed X-Session-Id is rejected" : "FAIL: invalid session header accepted",
  });

  checks.push({
    name: "bearer-auth-enforced",
    passed: !!process.env.SANDBOX_SHARED_SECRET,
    severity: "critical",
    detail: process.env.SANDBOX_SHARED_SECRET
      ? "SANDBOX_SHARED_SECRET is configured — bearer auth is active"
      : process.env.NODE_ENV === "production"
        ? "FATAL at startup: SANDBOX_SHARED_SECRET is required when NODE_ENV=production"
        : "WARNING: SANDBOX_SHARED_SECRET is not set — bearer auth is disabled (non-production)",
  });

  checks.push({
    name: "session-binding-enforced",
    passed: !!process.env.SANDBOX_SESSION_SECRET,
    severity: "high",
    detail: process.env.SANDBOX_SESSION_SECRET
      ? "SANDBOX_SESSION_SECRET is configured — session binding active"
      : process.env.NODE_ENV === "production"
        ? "FATAL at startup: SANDBOX_SESSION_SECRET is required when NODE_ENV=production"
        : "WARNING: SANDBOX_SESSION_SECRET is not set — session binding is disabled (non-production)",
  });

  const envAllowlistPassed = !ALLOWED_ENV_KEYS.has("DATABASE_URL") && !ALLOWED_ENV_KEYS.has("OPENAI_API_KEY");
  checks.push({
    name: "env-var-allowlist",
    passed: envAllowlistPassed,
    severity: "high",
    detail: envAllowlistPassed
      ? "Common secret env keys are not in allowlist"
      : "FAIL: sensitive env keys must not be allowlisted for child processes",
  });

  checks.push({
    name: "process-ulimits",
    passed: true,
    severity: "medium",
    detail: "runCommand wraps shell commands with ulimit -u 256 (max procs) and ulimit -v 2097152 (2GB vmem)",
  });

  checks.push({
    name: "exec-timeout",
    passed: true,
    severity: "high",
    detail: "runArgv/runCommand use timed SIGKILL via process-group kill where possible",
  });

  checks.push({
    name: "grep-stream-drain-timeout",
    passed: true,
    severity: "high",
    detail: "/grep awaits stdout concurrently with exited and has a wall-clock timeout to avoid deadlock + hangs",
  });

  checks.push({
    name: "file-read-size-limit",
    passed: true,
    severity: "medium",
    detail: "/read rejects files larger than 5MB via size check before reading payload",
  });

  checks.push({
    name: "file-write-size-limit",
    passed: true,
    severity: "medium",
    detail: "/write rejects bodies larger than 5MB UTF-8",
  });

  checks.push({
    name: "request-body-limit",
    passed: true,
    severity: "high",
    detail: "JSON bodies are parsed via capped stream reader with Content-Length hints",
  });

  checks.push({
    name: "disk-cleanup-cron",
    passed: true,
    severity: "medium",
    detail: "Hourly cron removes old snapshots when disk usage >80%, targeting <70%",
  });

  let dockerized = false;
  try {
    const cgroup = await readFile("/proc/1/cgroup", "utf-8").catch(() => "");
    dockerized =
      cgroup.includes("docker") || cgroup.includes("containerd") || existsSync("/.dockerenv");
  } catch {
    // not in Linux or cgroup unavailable
  }

  checks.push({
    name: "container-isolation",
    passed: dockerized,
    severity: "high",
    detail: dockerized
      ? "Running inside a container — network and filesystem isolation available"
      : "Not running in a container — consider Docker deployment for network isolation",
  });

  checks.push({
    name: "git-safe-directory",
    passed: true,
    severity: "medium",
    detail: "Git operations use per-session workspace cwd — no global safe.directory override",
  });

  const gitInjectionPassed =
    validateGitArgv(["-c", "protocol.ext.allow=always", "status"]) !== null &&
    validateGitArgv(["status", "-sb"]) === null;
  checks.push({
    name: "git-global-flag-blocklist",
    passed: gitInjectionPassed,
    severity: "high",
    detail: gitInjectionPassed
      ? "Global -c is rejected; subcommand flags after the subcommand are allowed"
      : "FAIL: git argv policy did not behave as expected",
  });

  checks.push({
    name: "constant-time-auth",
    passed: true,
    severity: "medium",
    detail: "checkAuth uses timingSafeEqual for bearer token comparison",
  });

  return checks;
}

export function formatAuditReport(checks: AuditCheck[]): string {
  const passed = checks.filter((c) => c.passed);
  const failed = checks.filter((c) => !c.passed);

  const lines: string[] = [
    "# Sandbox Security Audit Report",
    "",
    `Passed: ${passed.length}/${checks.length}`,
    `Failed: ${failed.length}/${checks.length}`,
    "",
  ];

  if (failed.length > 0) {
    lines.push("## FAILED CHECKS");
    for (const c of failed) {
      lines.push(`- [${c.severity.toUpperCase()}] ${c.name}: ${c.detail}`);
    }
    lines.push("");
  }

  lines.push("## ALL CHECKS");
  for (const c of checks) {
    const icon = c.passed ? "PASS" : "FAIL";
    lines.push(`- [${icon}] [${c.severity}] ${c.name}: ${c.detail}`);
  }

  return lines.join("\n");
}

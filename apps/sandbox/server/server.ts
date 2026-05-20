import { mkdirSync } from "node:fs";
import { formatAuditReport, runSecurityAudit } from "../lib/security-audit";
import { PayloadTooLargeError, parseLimitedJsonBody } from "./lib/body-parser";
import { MAX_REQUEST_BODY_BYTES, PORT, SNAPSHOT_DIR } from "./lib/constants";
import { startSnapshotCleanupCron } from "./lib/disk-usage";
import { getRequestId, jsonError } from "./lib/http-response";
import { logger } from "./lib/logger";
import { assertProductionSecretsOrExit, checkAuth, checkSessionBinding } from "./middleware/auth";
import { handleCloneWorkspace } from "./handlers/clone";
import { handleExec } from "./handlers/exec-http";
import { handleGlob, handleGrep, handleRead, handleWrite } from "./handlers/files";
import { handleGit } from "./handlers/git-http";
import { handleHealth } from "./handlers/health";
import { handleRestore, handleSnapshot } from "./handlers/snapshots";
import { handleVerify } from "./handlers/verify";

try {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
} catch (e) {
  logger.warn("snapshot_dir_unavailable", {
    path: SNAPSHOT_DIR,
    err: e instanceof Error ? e.message : String(e),
  });
}

assertProductionSecretsOrExit();

startSnapshotCleanupCron();

function asRecordBody(parsed: unknown): Record<string, unknown> {
  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;
    const path = url.pathname;

    logger.info("request", {
      method,
      path,
      requestId: getRequestId(req),
    });

    try {
      if (method === "GET" && path === "/health") {
        return handleHealth();
      }

      if (method === "GET" && path === "/security-audit") {
        const authError = checkAuth(req);
        if (authError) return authError;
        const checks = await runSecurityAudit();
        const allPassed = checks.every((c) => c.passed || c.severity === "low");
        return Response.json({ ok: allPassed, checks, report: formatAuditReport(checks) });
      }

      const authError = checkAuth(req);
      if (authError) return authError;

      const sessionErr = checkSessionBinding(req);
      if (sessionErr) return sessionErr;

      try {
        if (method === "POST" && path === "/clone-workspace") {
          const body = asRecordBody(await parseLimitedJsonBody(req, MAX_REQUEST_BODY_BYTES));
          return handleCloneWorkspace(req, body);
        }
        if (method === "POST" && path === "/exec") {
          const body = asRecordBody(await parseLimitedJsonBody(req, MAX_REQUEST_BODY_BYTES));
          return handleExec(req, body);
        }
        if (method === "POST" && path === "/read") {
          const body = asRecordBody(await parseLimitedJsonBody(req, MAX_REQUEST_BODY_BYTES));
          return handleRead(req, body);
        }
        if (method === "POST" && path === "/write") {
          const body = asRecordBody(await parseLimitedJsonBody(req, MAX_REQUEST_BODY_BYTES));
          return handleWrite(req, body);
        }
        if (method === "POST" && path === "/glob") {
          const body = asRecordBody(await parseLimitedJsonBody(req, MAX_REQUEST_BODY_BYTES));
          return handleGlob(req, body);
        }
        if (method === "POST" && path === "/grep") {
          const body = asRecordBody(await parseLimitedJsonBody(req, MAX_REQUEST_BODY_BYTES));
          return handleGrep(req, body);
        }
        if (method === "POST" && path === "/git") {
          const body = asRecordBody(await parseLimitedJsonBody(req, MAX_REQUEST_BODY_BYTES));
          return handleGit(req, body);
        }
        if (method === "POST" && path === "/verify") {
          const body = asRecordBody(await parseLimitedJsonBody(req, MAX_REQUEST_BODY_BYTES));
          return handleVerify(req, body);
        }

        const snapshotMatch = path.match(/^\/snapshot\/([^/]+)$/);
        if (method === "POST" && snapshotMatch) {
          return handleSnapshot(req, snapshotMatch[1]!);
        }

        const restoreMatch = path.match(/^\/restore\/([^/]+)$/);
        if (method === "POST" && restoreMatch) {
          return handleRestore(req, restoreMatch[1]!);
        }
      } catch (innerErr) {
        if (innerErr instanceof PayloadTooLargeError) {
          return jsonError(req, 413, innerErr.code, innerErr.message);
        }
        throw innerErr;
      }

      return Response.json(
        { error: { code: "NOT_FOUND", message: "Not found", requestId: getRequestId(req) } },
        { status: 404, headers: { "X-Request-Id": getRequestId(req) } },
      );
    } catch (error) {
      const requestId = getRequestId(req);
      logger.error("request_failed", {
        requestId,
        err: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof Error) {
        const message = error.message;
        if (message.includes("traversal") || message.includes("symlink")) {
          return jsonError(req, 400, "PATH_TRAVERSAL", message);
        }
        if (message.includes("session-id") || message.includes("X-Session-Id")) {
          return jsonError(req, 400, "SESSION_ID_INVALID", message);
        }
      }

      return jsonError(req, 500, "INTERNAL_ERROR", "Internal server error");
    }
  },
});

logger.info("sandbox_listen", { port: server.port });

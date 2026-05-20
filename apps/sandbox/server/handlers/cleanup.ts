import { existsSync } from "node:fs";
import { SAFE_SANDBOX_ID_PATTERN } from "../lib/constants";
import { getRequestId, jsonError } from "../lib/http-response";
import { getSessionWorkspace } from "../lib/path-security";
import { runArgv } from "../lib/process";
import { logger } from "../lib/logger";

export async function handleCleanup(req: Request): Promise<Response> {
  const sessionId = req.headers.get("x-session-id") ?? "";
  if (!SAFE_SANDBOX_ID_PATTERN.test(sessionId)) {
    return jsonError(req, 400, "SESSION_ID_INVALID", "Invalid session id");
  }

  const workspacePath = getSessionWorkspace(sessionId);

  if (!existsSync(workspacePath)) {
    return Response.json(
      { ok: true, cleaned: false, message: "Workspace does not exist" },
      { headers: { "X-Request-Id": getRequestId(req) } },
    );
  }

  const result = await runArgv(["rm", "-rf", workspacePath], "/", 120_000);
  if (result.exitCode !== 0) {
    logger.error("cleanup_failed", { sessionId, stderr: result.stderr });
    return jsonError(req, 500, "CLEANUP_FAILED", "Failed to remove workspace");
  }

  logger.info("workspace_cleaned", { sessionId });
  return Response.json(
    { ok: true, cleaned: true },
    { headers: { "X-Request-Id": getRequestId(req) } },
  );
}

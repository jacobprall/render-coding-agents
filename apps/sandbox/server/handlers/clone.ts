import { existsSync } from "node:fs";
import { SAFE_SANDBOX_ID_PATTERN, WORKSPACE_ROOT } from "../lib/constants";
import { getRequestId, jsonError } from "../lib/http-response";
import { getSessionWorkspace } from "../lib/path-security";
import { runArgv } from "../lib/process";

export async function handleCloneWorkspace(req: Request, body: Record<string, unknown>): Promise<Response> {
  const fromSessionId = typeof body.fromSessionId === "string" ? body.fromSessionId : "";
  const toSessionId = typeof body.toSessionId === "string" ? body.toSessionId : "";

  if (!SAFE_SANDBOX_ID_PATTERN.test(fromSessionId) || !SAFE_SANDBOX_ID_PATTERN.test(toSessionId)) {
    return jsonError(req, 400, "SESSION_ID_INVALID", "Invalid session id");
  }
  if (fromSessionId === toSessionId) {
    return jsonError(req, 400, "VALIDATION_ERROR", "fromSessionId and toSessionId must differ");
  }

  const fromPath = getSessionWorkspace(fromSessionId);
  const toPath = getSessionWorkspace(toSessionId);

  if (!existsSync(fromPath)) {
    return jsonError(req, 404, "WORKSPACE_NOT_FOUND", "Source workspace does not exist");
  }

  if (existsSync(toPath)) {
    const rm = await runArgv(["rm", "-rf", toPath], "/", 120_000);
    if (rm.exitCode !== 0) {
      return jsonError(req, 500, "CLONE_FAILED", "Could not clear target workspace");
    }
  }

  const result = await runArgv(["cp", "-a", fromPath, toPath], WORKSPACE_ROOT, 600_000);
  if (result.exitCode !== 0) {
    return jsonError(req, 500, "CLONE_FAILED", "Workspace copy failed");
  }

  return Response.json({ ok: true }, { headers: { "X-Request-Id": getRequestId(req) } });
}

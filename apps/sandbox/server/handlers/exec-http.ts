import { jsonError } from "../lib/http-response";
import { getSessionWorkspace, getSessionId } from "../lib/path-security";
import { runCommand } from "../lib/process";

export async function handleExec(req: Request, body: Record<string, unknown>): Promise<Response> {
  const sessionId = getSessionId(req);
  const command = typeof body.command === "string" ? body.command : "";
  const timeoutMs = typeof body.timeoutMs === "number" ? body.timeoutMs : undefined;

  if (!command) {
    return jsonError(req, 400, "VALIDATION_ERROR", "command is required");
  }

  const cwd = getSessionWorkspace(sessionId);
  const result = await runCommand(command, cwd, timeoutMs);
  return Response.json(result);
}

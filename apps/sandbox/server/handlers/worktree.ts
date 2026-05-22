import { createWorktree, removeWorktree } from "../services/mirror-manager";
import { getRequestId, jsonError } from "../lib/http-response";
import { logger } from "../lib/logger";

export async function handleWorktreeCreate(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const { workspaceId, sessionId, repoPath, branchName, baseBranch } = body;
  if (!workspaceId || !sessionId || !repoPath) {
    return jsonError(req, 400, "MISSING_PARAMS", "workspaceId, sessionId, and repoPath are required");
  }

  try {
    const result = createWorktree({
      workspaceId: String(workspaceId),
      sessionId: String(sessionId),
      repoPath: String(repoPath),
      branchName: String(branchName ?? `agent/${sessionId}`),
      baseBranch: String(baseBranch ?? "main"),
    });
    return Response.json(result);
  } catch (err) {
    logger.error("worktree_create_failed", {
      workspaceId,
      sessionId,
      repoPath,
      err: err instanceof Error ? err.message : String(err),
      requestId: getRequestId(req),
    });
    return jsonError(req, 500, "WORKTREE_ERROR", "Failed to create worktree");
  }
}

export async function handleWorktreeRemove(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const { sessionId, repoPath } = body;
  if (!sessionId || !repoPath) {
    return jsonError(req, 400, "MISSING_PARAMS", "sessionId and repoPath are required");
  }

  try {
    const removed = removeWorktree(String(sessionId), String(repoPath));
    return Response.json({ removed });
  } catch (err) {
    logger.error("worktree_remove_failed", {
      sessionId,
      repoPath,
      err: err instanceof Error ? err.message : String(err),
      requestId: getRequestId(req),
    });
    return jsonError(req, 500, "WORKTREE_ERROR", "Failed to remove worktree");
  }
}

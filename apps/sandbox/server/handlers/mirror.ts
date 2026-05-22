import { getDiskStatus } from "../services/disk-monitor";
import { ensureMirror, fetchMirror } from "../services/mirror-manager";
import { getRequestId, jsonError } from "../lib/http-response";
import { logger } from "../lib/logger";

export async function handleMirrorEnsure(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const { workspaceId, repoPath, cloneUrl } = body;
  if (!workspaceId || !repoPath || !cloneUrl) {
    return jsonError(req, 400, "MISSING_PARAMS", "workspaceId, repoPath, and cloneUrl are required");
  }

  try {
    const result = ensureMirror(String(workspaceId), String(repoPath), String(cloneUrl));
    return Response.json(result);
  } catch (err) {
    logger.error("mirror_ensure_failed", {
      workspaceId,
      repoPath,
      err: err instanceof Error ? err.message : String(err),
      requestId: getRequestId(req),
    });
    return jsonError(req, 500, "MIRROR_ERROR", "Failed to ensure mirror");
  }
}

export async function handleMirrorFetch(
  req: Request,
  body: Record<string, unknown>,
): Promise<Response> {
  const { workspaceId, repoPath } = body;
  if (!workspaceId || !repoPath) {
    return jsonError(req, 400, "MISSING_PARAMS", "workspaceId and repoPath are required");
  }

  try {
    const result = fetchMirror(String(workspaceId), String(repoPath));
    return Response.json(result);
  } catch (err) {
    logger.error("mirror_fetch_failed", {
      workspaceId,
      repoPath,
      err: err instanceof Error ? err.message : String(err),
      requestId: getRequestId(req),
    });
    return jsonError(req, 500, "MIRROR_ERROR", "Failed to fetch mirror");
  }
}

export function handleDiskStatus(): Response {
  const status = getDiskStatus();
  return Response.json(status);
}

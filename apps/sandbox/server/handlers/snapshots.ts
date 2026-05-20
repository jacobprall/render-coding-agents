import { join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import type { SnapshotResult } from "../../types";
import { SNAPSHOT_DIR, WORKSPACE_ROOT } from "../lib/constants";
import { getRequestId, jsonError } from "../lib/http-response";
import { getSessionWorkspace, getSessionId, validateSnapshotId } from "../lib/path-security";
import { runArgv } from "../lib/process";

export async function handleSnapshot(req: Request, snapshotId: string): Promise<Response> {
  if (!validateSnapshotId(snapshotId)) {
    return jsonError(req, 400, "VALIDATION_ERROR", "Invalid snapshot ID");
  }

  const sessionId = getSessionId(req);
  const sessionSnapDir = join(SNAPSHOT_DIR, sessionId);
  mkdirSync(sessionSnapDir, { recursive: true });
  const snapshotPath = join(sessionSnapDir, `${snapshotId}.tar.gz`);
  const sourcePath = getSessionWorkspace(sessionId);

  if (!existsSync(sourcePath)) {
    return jsonError(req, 404, "WORKSPACE_NOT_FOUND", "Session workspace does not exist");
  }

  const result = await runArgv(
    ["tar", "-czf", snapshotPath, "-C", WORKSPACE_ROOT, sessionId],
    WORKSPACE_ROOT,
    120_000,
  );

  if (result.exitCode !== 0) {
    return jsonError(req, 500, "SNAPSHOT_FAILED", "Failed to create snapshot");
  }

  const stat = Bun.file(snapshotPath);
  const sizeBytes = (await stat.exists()) ? stat.size : 0;

  const snapshotResult: SnapshotResult = { snapshotId, sizeBytes };
  return Response.json(snapshotResult, { headers: { "X-Request-Id": getRequestId(req) } });
}

export async function handleRestore(req: Request, snapshotId: string): Promise<Response> {
  if (!validateSnapshotId(snapshotId)) {
    return jsonError(req, 400, "VALIDATION_ERROR", "Invalid snapshot ID");
  }

  const sessionId = getSessionId(req);
  const snapshotPath = join(SNAPSHOT_DIR, sessionId, `${snapshotId}.tar.gz`);
  const targetPath = getSessionWorkspace(sessionId);

  if (!existsSync(snapshotPath)) {
    return jsonError(req, 404, "SNAPSHOT_NOT_FOUND", "Snapshot not found");
  }

  mkdirSync(targetPath, { recursive: true });
  const result = await runArgv(["tar", "-xzf", snapshotPath, "-C", WORKSPACE_ROOT], WORKSPACE_ROOT, 120_000);

  if (result.exitCode !== 0) {
    return jsonError(req, 500, "SNAPSHOT_RESTORE_FAILED", "Failed to restore snapshot");
  }

  return Response.json({ ok: true }, { headers: { "X-Request-Id": getRequestId(req) } });
}

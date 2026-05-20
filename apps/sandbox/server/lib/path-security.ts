import { join, resolve, sep } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { SAFE_SANDBOX_ID_PATTERN, WORKSPACE_ROOT } from "./constants";

/** Returns absolute session workspace dir (logical path before realpath hardening). */
export function getSessionWorkspace(sessionId: string): string {
  return resolve(join(WORKSPACE_ROOT, sessionId));
}

/**
 * Validates a relative path resolves under the session workspace.
 * Caller should call `assertRealPathWithinSessionWorkspace` immediately before/after filesystem ops
 * where TOCTOU is a concern.
 */
export function validatePath(sessionId: string, filePath: string): string {
  const sessionWs = getSessionWorkspace(sessionId);
  const resolved = resolve(join(sessionWs, filePath));

  const rootLen = sessionWs.length;
  const underRoot =
    resolved === sessionWs || (resolved.length > rootLen && resolved.startsWith(sessionWs + sep));

  if (!underRoot) {
    throw new Error(`Path traversal attempt detected: ${filePath}`);
  }

  if (existsSync(resolved)) {
    let realRoot = sessionWs;
    if (existsSync(sessionWs)) {
      try {
        realRoot = realpathSync(sessionWs);
      } catch {
        realRoot = sessionWs;
      }
    }

    const realPath = realpathSync(resolved);
    const rrLen = realRoot.length;
    const underReal =
      realPath === realRoot || (realPath.length > rrLen && realPath.startsWith(realRoot + sep));

    if (!underReal) {
      throw new Error(`Path escapes session workspace (symlink)`);
    }
  }

  return resolved;
}

/**
 * Confirms realpath(...) still lies inside the session workspace (post-open / post-write guard).
 */
export function assertRealPathWithinSessionWorkspace(resolvedAbsolutePath: string, sessionId: string): void {
  const sessionWs = getSessionWorkspace(sessionId);
  let realRoot = sessionWs;
  if (existsSync(sessionWs)) {
    try {
      realRoot = realpathSync(sessionWs);
    } catch {
      realRoot = sessionWs;
    }
  }

  const realPath = realpathSync(resolvedAbsolutePath);
  const rrLen = realRoot.length;
  const ok =
    realPath === realRoot ||
    (realPath.length > rrLen && realPath.startsWith(realRoot + sep));

  if (!ok) {
    throw new Error(`Path escapes session workspace (symlink)`);
  }
}

export function getSessionId(req: Request): string {
  const sessionId = req.headers.get("x-session-id");
  if (!sessionId || !SAFE_SANDBOX_ID_PATTERN.test(sessionId)) {
    throw new Error("Missing or invalid X-Session-Id header");
  }
  return sessionId;
}

export function validateSnapshotId(snapshotId: string): boolean {
  return SAFE_SANDBOX_ID_PATTERN.test(snapshotId);
}

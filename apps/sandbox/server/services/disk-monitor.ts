import { execSync } from "node:child_process";
import { WORKSPACE_ROOT } from "../lib/constants";
import { logger } from "../lib/logger";
import { listMirrors, removeMirror } from "./mirror-manager";

const WARNING_THRESHOLD = 0.70;
const CRITICAL_THRESHOLD = 0.85;
const EVICTION_THRESHOLD = 0.80;

export interface DiskStatus {
  totalBytes: number;
  usedBytes: number;
  mirrorBytes: number;
  usagePercent: number;
  mirrorCount: number;
  worktreeCount: number;
  alertLevel: "ok" | "warning" | "critical";
}

export function getDiskStatus(): DiskStatus {
  let totalBytes = 0;
  let usedBytes = 0;

  try {
    const dfOutput = execSync(`df -B1 "${WORKSPACE_ROOT}" | tail -1`, {
      encoding: "utf-8",
      timeout: 5_000,
    });
    const parts = dfOutput.trim().split(/\s+/);
    totalBytes = parseInt(parts[1] ?? "0", 10);
    usedBytes = parseInt(parts[2] ?? "0", 10);
  } catch {
    totalBytes = 20 * 1024 * 1024 * 1024;
    usedBytes = 0;
  }

  const mirrors = listMirrors();
  const mirrorBytes = mirrors.reduce((sum, m) => sum + m.sizeBytes, 0);

  let worktreeCount = 0;
  try {
    const wcOutput = execSync(
      `find "${WORKSPACE_ROOT}" -maxdepth 3 -name ".git" -type f 2>/dev/null | wc -l`,
      { encoding: "utf-8", timeout: 10_000 },
    );
    worktreeCount = parseInt(wcOutput.trim(), 10);
  } catch {
    worktreeCount = 0;
  }

  const usagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;

  let alertLevel: "ok" | "warning" | "critical" = "ok";
  if (usagePercent / 100 >= CRITICAL_THRESHOLD) {
    alertLevel = "critical";
  } else if (usagePercent / 100 >= WARNING_THRESHOLD) {
    alertLevel = "warning";
  }

  return {
    totalBytes,
    usedBytes,
    mirrorBytes,
    usagePercent: Math.round(usagePercent * 10) / 10,
    mirrorCount: mirrors.length,
    worktreeCount,
    alertLevel,
  };
}

export function evictLRU(): { evicted: string[]; freedBytes: number } {
  const status = getDiskStatus();
  if (status.usagePercent / 100 < EVICTION_THRESHOLD) {
    return { evicted: [], freedBytes: 0 };
  }

  const mirrors = listMirrors();
  mirrors.sort((a, b) => a.lastAccessedMs - b.lastAccessedMs);

  const evicted: string[] = [];
  let freedBytes = 0;
  let currentUsage = status.usedBytes;

  for (const mirror of mirrors) {
    if (currentUsage / status.totalBytes < EVICTION_THRESHOLD - 0.10) break;

    const key = `${mirror.workspaceId}/${mirror.repoPath}`;
    if (removeMirror(mirror.workspaceId, mirror.repoPath)) {
      evicted.push(key);
      freedBytes += mirror.sizeBytes;
      currentUsage -= mirror.sizeBytes;
      logger.info("mirror_evicted", {
        workspaceId: mirror.workspaceId,
        repoPath: mirror.repoPath,
        freedBytes: mirror.sizeBytes,
      });
    }
  }

  if (evicted.length > 0) {
    logger.info("lru_eviction_complete", {
      evicted: evicted.length,
      freedBytes,
      newUsagePercent: Math.round(((currentUsage / status.totalBytes) * 100) * 10) / 10,
    });
  }

  return { evicted, freedBytes };
}

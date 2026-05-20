import { join } from "node:path";
import { statfs } from "node:fs/promises";
import { SNAPSHOT_DIR, WORKSPACE_ROOT } from "./constants";
import { logger } from "./logger";

export interface DiskUsage {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  percentUsed: number;
}

export async function getDiskUsage(path: string): Promise<DiskUsage | null> {
  try {
    const stats = await statfs(path);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bfree * stats.bsize;
    const usedBytes = totalBytes - freeBytes;
    const percentUsed = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;
    return { totalBytes, usedBytes, freeBytes, percentUsed };
  } catch {
    return null;
  }
}

/** Hourly passive cleanup — removes oldest snapshots when disk use is high */
export function startSnapshotCleanupCron(): ReturnType<typeof setInterval> {
  return setInterval(async () => {
    try {
      const usage = await getDiskUsage(WORKSPACE_ROOT);
      if (!usage) return;

      const percentUsedPrecise =
        usage.totalBytes > 0 ? (usage.usedBytes / usage.totalBytes) * 100 : 0;
      if (percentUsedPrecise < 80) return;

      logger.info("Disk usage elevated; cleaning old snapshots", {
        diskPercentRounded: usage.percentUsed,
        diskPercent: percentUsedPrecise,
      });

      const glob = new Bun.Glob("**/*.tar.gz");
      const snapshots: Array<{ path: string; mtime: number }> = [];

      for await (const file of glob.scan({ cwd: SNAPSHOT_DIR, onlyFiles: true })) {
        const fullPath = join(SNAPSHOT_DIR, file);
        const stat = Bun.file(fullPath);
        snapshots.push({ path: fullPath, mtime: (await stat.lastModified) ?? 0 });
      }

      snapshots.sort((a, b) => a.mtime - b.mtime);

      for (const snap of snapshots) {
        const currentUsage = await getDiskUsage(WORKSPACE_ROOT);
        if (!currentUsage) break;

        const pct =
          currentUsage.totalBytes > 0 ? (currentUsage.usedBytes / currentUsage.totalBytes) * 100 : 0;
        if (pct < 70) break;

        try {
          await Bun.file(snap.path).delete();
          logger.info("Removed snapshot during cleanup", { path: snap.path });
        } catch (delErr) {
          logger.error("Failed to remove snapshot during cleanup", {
            path: snap.path,
            err: delErr instanceof Error ? delErr.message : String(delErr),
          });
        }
      }
    } catch (err) {
      logger.error("Snapshot cleanup cron error", { err: err instanceof Error ? err.message : String(err) });
    }
  }, 60 * 60 * 1000);
}

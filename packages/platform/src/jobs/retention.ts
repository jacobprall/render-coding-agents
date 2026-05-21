import type { PlatformContainer } from "../container";

const DEFAULT_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startObservabilityRetentionLoop(
  platform: PlatformContainer,
  options?: {
    intervalMs?: number;
    retentionDays?: number;
    logger?: (message: string, meta?: Record<string, unknown>) => void;
  },
): () => void {
  const retentionDays = options?.retentionDays ?? parseInt(process.env.OBSERVABILITY_RETENTION_DAYS ?? "30", 10);
  const intervalMs = options?.intervalMs ?? parseInt(
    process.env.OBSERVABILITY_RETENTION_INTERVAL_MS ?? String(DEFAULT_RETENTION_INTERVAL_MS),
    10,
  );
  const log = options?.logger ?? ((message: string, meta?: Record<string, unknown>) => {
    console.info(message, meta ?? {});
  });

  const tick = async () => {
    try {
      const result = await platform.observability.runRetention(retentionDays);
      log("[observability] retention completed", {
        deleted: result.deleted,
        retentionDays,
      });
    } catch (error) {
      console.warn("[observability] retention failed", error);
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return () => clearInterval(timer);
}

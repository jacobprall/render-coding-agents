import { Hono } from "hono";
import { getPlatform, getRedis } from "../platform";

export const healthRoutes = new Hono();

type CheckResult = { status: "ok" | "error"; latencyMs?: number; error?: string };

async function checkPostgres(): Promise<CheckResult> {
  const start = Date.now();
  try {
    const result = await getPlatform().db.execute("SELECT 1");
    return { status: result ? "ok" : "error", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - start, error: err instanceof Error ? err.message : "Unknown" };
  }
}

async function checkRedis(): Promise<CheckResult> {
  const start = Date.now();
  try {
    await Promise.race([
      getRedis().ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return { status: "error", latencyMs: Date.now() - start, error: err instanceof Error ? err.message : "Unknown" };
  }
}

healthRoutes.get("/", async (c) => {
  const [postgres, redis] = await Promise.all([
    checkPostgres(),
    checkRedis(),
  ]);

  const checks: Record<string, CheckResult> = { postgres, redis };
  const allOk = Object.values(checks).every((ch) => ch.status === "ok");
  const anyOk = Object.values(checks).some((ch) => ch.status === "ok");
  const status = allOk ? "healthy" : anyOk ? "degraded" : "unhealthy";

  return c.json({ status, checks }, status === "unhealthy" ? 503 : 200);
});

healthRoutes.get("/workers", async (c) => {
  try {
    const redis = getRedis();
    const workerKeys = await redis.keys("worker:heartbeat:*");
    let activeCount = 0;
    for (const key of workerKeys) {
      const raw = await redis.get(key);
      if (raw) activeCount++;
    }
    return c.json({ hasActiveWorkers: activeCount > 0, activeWorkers: activeCount });
  } catch (err) {
    return c.json(
      { hasActiveWorkers: false, error: err instanceof Error ? err.message : "Unknown" },
      500,
    );
  }
});

import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedObservabilityRequest } from "@/lib/api/observability-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error";

interface HealthCheck {
  status: CheckStatus;
  latencyMs?: number;
  error?: string;
}

async function checkPostgres(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { getDb } = await import("@/lib/db");
    const db = getDb();
    await db.execute(/* sql */ `SELECT 1`);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

async function checkRedis(): Promise<HealthCheck> {
  const start = Date.now();
  try {
    const { getSharedRedisClient, isRedisConfigured } = await import("@/lib/redis");
    if (!isRedisConfigured()) {
      return { status: "error", error: "REDIS_URL not configured" };
    }
    const redis = getSharedRedisClient();
    const PING_MS = 3000;
    const ping = redis.ping();
    const timeout = new Promise<never>((_, reject) => {
      const t = setTimeout(() => reject(new Error("Redis ping timeout")), PING_MS);
      t.unref?.();
    });
    await Promise.race([ping, timeout]);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "error",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedObservabilityRequest(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [postgres, redis] = await Promise.all([
    checkPostgres(),
    checkRedis(),
  ]);

  const checks = { postgres, redis };
  const allOk = Object.values(checks).every((c) => c.status === "ok");
  const anyOk = Object.values(checks).some((c) => c.status === "ok");

  const status = allOk ? "healthy" : anyOk ? "degraded" : "unhealthy";

  return NextResponse.json(
    { status, checks, ts: Date.now(), env: process.env.NODE_ENV ?? "development" },
    { status: status === "unhealthy" ? 503 : 200 },
  );
}

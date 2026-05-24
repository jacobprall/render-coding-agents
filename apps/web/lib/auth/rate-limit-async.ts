import type { RateLimitResult } from "./rate-limit";
import { checkRateLimit as checkInMemoryRateLimit } from "./rate-limit";

/**
 * Redis-backed rate limiting for route handlers (Node.js runtime only).
 * Falls back to in-memory when Redis is not configured.
 */
export async function checkRateLimitAsync(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const { isRedisConfigured, getSharedRedisClient } = await import("@/lib/redis");

  if (!isRedisConfigured()) {
    return checkInMemoryRateLimit(key, maxRequests, windowMs);
  }

  const redis = getSharedRedisClient();
  const now = Date.now();
  const windowKey = `${key}:${Math.floor(now / windowMs)}`;
  const resetAt = (Math.floor(now / windowMs) + 1) * windowMs;

  try {
    const count = await redis.incr(windowKey);
    if (count === 1) {
      await redis.pexpire(windowKey, windowMs);
    }

    if (count > maxRequests) {
      return { allowed: false, remaining: 0, resetAt };
    }

    return {
      allowed: true,
      remaining: maxRequests - count,
      resetAt,
    };
  } catch {
    return { allowed: true, remaining: maxRequests - 1, resetAt: now + windowMs };
  }
}

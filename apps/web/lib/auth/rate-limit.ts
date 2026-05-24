export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * In-memory fixed-window rate limiter. Safe for Edge Runtime (middleware).
 * For distributed Redis-backed limiting in route handlers, use checkRateLimitAsync
 * from `@/lib/auth/rate-limit-async`.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  return checkInMemoryRateLimit(key, maxRequests, windowMs);
}

// ---------------------------------------------------------------------------
// Synchronous fallback (for Next.js middleware which must be sync)
// Uses an in-memory Map. Not distributed but better than nothing.
// ---------------------------------------------------------------------------

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

let cleanupIntervalStarted = false;

export function cleanupExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now >= entry.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}

if (typeof setInterval === "function" && !cleanupIntervalStarted) {
  cleanupIntervalStarted = true;
  setInterval(cleanupExpiredEntries, 60_000);
}

export function checkInMemoryRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now >= entry.resetAt) {
    const resetAt = now + windowMs;
    rateLimitStore.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: maxRequests - entry.count,
    resetAt: entry.resetAt,
  };
}

export function getRateLimitHeaders(
  result: RateLimitResult,
): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}

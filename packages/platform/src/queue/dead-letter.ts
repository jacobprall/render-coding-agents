import type Redis from "ioredis";
import { AGENT_JOBS_STREAM } from "./job-queue";

export const DEAD_LETTER_KEY = "agent:dead-letter";

export async function moveToDeadLetter(
  redis: Redis,
  job: unknown,
  error: string,
): Promise<void> {
  const entry = JSON.stringify({
    id: crypto.randomUUID(),
    job,
    error,
    movedAt: new Date().toISOString(),
  });
  await redis.lpush(DEAD_LETTER_KEY, entry);
}

export async function listDeadLetterJobs(
  redis: Redis,
  limit = 50,
): Promise<unknown[]> {
  const entries = await redis.lrange(DEAD_LETTER_KEY, 0, limit - 1);
  return entries.map((e) => JSON.parse(e));
}

export async function retryDeadLetterJob(
  redis: Redis,
  jobId: string,
): Promise<boolean> {
  const entries = await redis.lrange(DEAD_LETTER_KEY, 0, -1);
  for (let i = 0; i < entries.length; i++) {
    const parsed = JSON.parse(entries[i]!);
    if (parsed.id === jobId) {
      await redis.lrem(DEAD_LETTER_KEY, 1, entries[i]!);
      // Re-enqueue onto the Streams queue (not the legacy list)
      await redis.xadd(AGENT_JOBS_STREAM, "*", "payload", JSON.stringify(parsed.job));
      return true;
    }
  }
  return false;
}

export async function discardDeadLetterJob(
  redis: Redis,
  jobId: string,
): Promise<boolean> {
  const entries = await redis.lrange(DEAD_LETTER_KEY, 0, -1);
  for (let i = 0; i < entries.length; i++) {
    const parsed = JSON.parse(entries[i]!);
    if (parsed.id === jobId) {
      await redis.lrem(DEAD_LETTER_KEY, 1, entries[i]!);
      return true;
    }
  }
  return false;
}

import type Redis from "ioredis";
import { RedisStreamError } from "@coding-agents/shared";

const STREAM_FIELD = "e";
const STREAM_MAXLEN = "2000";

function parseStreamEntries(entries: [string, string[]][] | null | undefined): {
  id: string;
  payload: string;
}[] {
  if (!entries?.length) return [];
  const out: { id: string; payload: string }[] = [];
  for (const [id, fields] of entries) {
    for (let i = 0; i < fields.length - 1; i += 2) {
      if (fields[i] === STREAM_FIELD) {
        out.push({ id, payload: fields[i + 1]! });
        break;
      }
    }
  }
  return out;
}

export function runEventStreamKey(runId: string): string {
  return `run:${runId}:events`;
}

export async function publishRunEvent(
  redis: Redis,
  runId: string,
  payloadJson: string,
): Promise<void> {
  const key = runEventStreamKey(runId);
  const streamId = await redis.xadd(key, "MAXLEN", "~", STREAM_MAXLEN, "*", STREAM_FIELD, payloadJson);
  try {
    const pubPayload = JSON.stringify({ _sid: streamId, ...JSON.parse(payloadJson) });
    await redis.publish(`run:${runId}`, pubPayload);
  } catch (err) {
    console.error("[run-stream] PUBLISH failed (XADD succeeded)", { runId, streamId, err });
  }
}

export async function readRunEventHistory(
  redis: Redis,
  runId: string,
  limit = 2000,
): Promise<string[]> {
  const { payloads } = await readRunEventHistoryDetailed(redis, runId, limit);
  return payloads;
}

export async function readRunEventHistoryDetailed(
  redis: Redis,
  runId: string,
  limit = 2000,
): Promise<{ entries: { id: string; payload: string }[]; payloads: string[]; lastStreamId: string | null }> {
  const key = runEventStreamKey(runId);
  try {
    const raw = (await redis.xrange(key, "-", "+", "COUNT", String(limit))) as
      | [string, string[]][]
      | null;
    const parsed = parseStreamEntries(raw);
    const lastStreamId = parsed.length > 0 ? parsed[parsed.length - 1]!.id : null;
    return { entries: parsed, payloads: parsed.map((p) => p.payload), lastStreamId };
  } catch (err) {
    throw new RedisStreamError(`Failed to read run event history for ${runId}`, {
      cause: err,
      details: { runId },
    });
  }
}

export async function readRunEventPayloadsAfterId(
  redis: Redis,
  runId: string,
  afterStreamId: string,
  limit = 2000,
): Promise<string[]> {
  const { entries } = await readRunEventEntriesAfterId(redis, runId, afterStreamId, limit);
  return entries.map((e) => e.payload);
}

export async function readRunEventEntriesAfterId(
  redis: Redis,
  runId: string,
  afterStreamId: string,
  limit = 2000,
): Promise<{ entries: { id: string; payload: string }[] }> {
  const key = runEventStreamKey(runId);
  try {
    const start = `(${afterStreamId}`;
    const raw = (await redis.xrange(key, start, "+", "COUNT", String(limit))) as
      | [string, string[]][]
      | null;
    return { entries: parseStreamEntries(raw) };
  } catch (err) {
    throw new RedisStreamError(`Failed to read run events after id for ${runId}`, {
      cause: err,
      details: { runId, afterStreamId },
    });
  }
}

export function askUserReplyQueueKey(runId: string, toolCallId: string): string {
  return `run:${runId}:ask:${toolCallId}`;
}

// ─── Steering channel helpers ─────────────────────────────────────────────────

export function steeringChannelKey(runId: string): string {
  return `run:${runId}:steering`;
}

export async function publishSteeringEvent(
  redis: Redis,
  runId: string,
  event: { type: string; content?: string; reason?: string; timestamp?: string },
): Promise<void> {
  const payload = JSON.stringify({ ...event, ts: event.timestamp ?? new Date().toISOString() });
  await redis.publish(steeringChannelKey(runId), payload);
  await redis.rpush(`run:${runId}:steering:queue`, payload);
  await redis.expire(`run:${runId}:steering:queue`, 3600);
}

export async function consumeSteeringEvents(
  redis: Redis,
  runId: string,
): Promise<Array<{ type: string; content?: string; reason?: string; ts: string }>> {
  const key = `run:${runId}:steering:queue`;
  const items = await redis.lrange(key, 0, -1);
  if (items.length > 0) {
    await redis.del(key);
  }
  return items.map((item) => {
    try {
      return JSON.parse(item);
    } catch {
      return { type: "unknown", ts: new Date().toISOString() };
    }
  });
}

export async function trimOldStreamEntries(
  redis: Redis,
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): Promise<{ trimmed: number }> {
  const cutoffMs = Date.now() - maxAgeMs;
  const cutoffId = `${cutoffMs}-0`;

  let trimmed = 0;
  let cursor = "0";

  do {
    const [nextCursor, keys] = await redis.scan(
      cursor,
      "MATCH",
      "run:*:events",
      "COUNT",
      100,
    );
    cursor = nextCursor;

    for (const key of keys) {
      try {
        const before = await redis.xlen(key);
        await redis.xtrim(key, "MINID", cutoffId);
        const after = await redis.xlen(key);
        trimmed += before - after;
      } catch {
        /* skip on error */
      }
    }
  } while (cursor !== "0");

  return { trimmed };
}

/**
 * SSE streaming endpoints for the gateway.
 *
 * - GET /sessions/:id  — real-time agent run events
 * - GET /inbox         — inbox count polling
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import Redis from "ioredis";
import { eq, and, desc, sql } from "drizzle-orm";
import { agentRuns, sessions, chats, prEvents } from "@coding-agents/db";
import {
  readRunEventHistoryDetailed,
  readRunEventEntriesAfterId,
} from "@coding-agents/platform";
import { normalizeEvent, isTerminalEvent as isTerminalEventCheck } from "@coding-agents/shared";
import type { GatewayEnv } from "../middleware/auth";
import { getPlatform } from "../platform";

export const streamRoutes = new Hono<GatewayEnv>();

const KEEPALIVE_MS = 25_000;
const INBOX_POLL_MS = 5_000;
const INBOX_HEARTBEAT_MS = 15_000;

function checkTerminal(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload);
    return isTerminalEventCheck(parsed);
  } catch {
    return false;
  }
}

function normalizePayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload);
    return JSON.stringify(normalizeEvent(parsed));
  } catch {
    return payload;
  }
}

function getRedisUrl(): string {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) throw new Error("REDIS_URL is required");
  return raw.includes("://") ? raw : `redis://${raw}`;
}

// ---------------------------------------------------------------------------
// Shared pub/sub subscriber (single Redis connection fans out to listeners)
// ---------------------------------------------------------------------------

type MessageHandler = (message: string) => void;
let sharedSub: Redis | null = null;
const channelListeners = new Map<string, Set<MessageHandler>>();

function ensureSharedSub(): Redis {
  if (sharedSub) return sharedSub;
  sharedSub = new Redis(getRedisUrl(), {
    connectionName: "gateway-sse-sub",
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
  sharedSub.on("message", (channel: string, message: string) => {
    const handlers = channelListeners.get(channel);
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(message); } catch { /* non-fatal */ }
    }
  });
  sharedSub.on("error", (err: Error) => {
    console.error("[gateway-sse] Redis sub error:", err.message);
  });
  return sharedSub;
}

async function subscribeToRun(
  runId: string,
  handler: MessageHandler,
): Promise<{ unsubscribe: () => Promise<void> }> {
  const sub = ensureSharedSub();
  const channel = `run:${runId}`;
  let handlers = channelListeners.get(channel);
  if (!handlers) {
    handlers = new Set();
    channelListeners.set(channel, handlers);
    await sub.subscribe(channel);
  }
  handlers.add(handler);
  return {
    unsubscribe: async () => {
      handlers!.delete(handler);
      if (handlers!.size === 0) {
        channelListeners.delete(channel);
        await sub.unsubscribe(channel).catch(() => {});
      }
    },
  };
}

// ---------------------------------------------------------------------------
// GET /sessions/:id — agent run event stream
// ---------------------------------------------------------------------------

streamRoutes.get("/sessions/:id", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const lastEventId =
    c.req.header("Last-Event-ID") ?? c.req.query("lastEventId") ?? null;
  const db = getPlatform().db;

  const [sessionRow, chatRow] = await Promise.all([
    db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1)
      .then((r) => r[0]),
    db
      .select({ activeRunId: chats.activeRunId })
      .from(chats)
      .where(eq(chats.sessionId, sessionId))
      .orderBy(desc(chats.createdAt))
      .limit(1)
      .then((r) => r[0]),
  ]);

  if (!sessionRow) return c.json({ error: "Session not found" }, 404);

  const runId = chatRow?.activeRunId;

  if (!runId) {
    c.header("Content-Type", "text/event-stream");
    c.header("Cache-Control", "no-cache, no-transform");
    return c.body(`data: ${JSON.stringify({ type: "no_active_run" })}\n\n`);
  }

  const cmd = new Redis(getRedisUrl(), {
    connectionName: `gateway-sse-cmd-${sessionId}`,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });

  // Step 1: Subscribe to pub/sub FIRST, buffering messages to close the race window
  const pubsubBuffer: { sid: string | null; payload: string }[] = [];
  let draining = false;

  let sub: Awaited<ReturnType<typeof subscribeToRun>> | null = null;
  try {
    sub = await subscribeToRun(runId, (message) => {
      let sid: string | null = null;
      try {
        const parsed = JSON.parse(message) as { _sid?: string };
        sid = parsed._sid ?? null;
      } catch { /* use null sid */ }
      if (!draining) {
        pubsubBuffer.push({ sid, payload: message });
      }
    });
  } catch {
    cmd.disconnect();
    c.header("Content-Type", "text/event-stream");
    return c.body(
      `data: ${JSON.stringify({ type: "error", code: "STREAM_INTERRUPTED", retryable: true })}\n\n`,
    );
  }

  // Step 2: Read history (from Last-Event-ID or beginning)
  type EventEntry = { id: string; payload: string };
  let historyEntries: EventEntry[];
  try {
    if (lastEventId) {
      const result = await readRunEventEntriesAfterId(cmd, runId, lastEventId);
      historyEntries = result.entries;
    } else {
      const result = await readRunEventHistoryDetailed(cmd, runId);
      historyEntries = result.entries;
    }
  } catch {
    await sub.unsubscribe().catch(() => {});
    cmd.disconnect();
    c.header("Content-Type", "text/event-stream");
    return c.body(
      `data: ${JSON.stringify({ type: "error", code: "REPLAY_FAILED", retryable: true })}\n\n`,
    );
  }

  const lastHistoryId = historyEntries.length > 0
    ? historyEntries[historyEntries.length - 1]!.id
    : lastEventId;

  // Check for a synthetic terminal if none was found in history
  let syntheticTerminal: string | null = null;
  const hasTerminal = historyEntries.some((e) => checkTerminal(e.payload));
  if (!hasTerminal) {
    const runStatus = await cmd.get(`run:${runId}:status`).catch(() => null);
    if (runStatus === "completed" || runStatus === "failed" || runStatus === "aborted") {
      const syntheticType =
        runStatus === "completed" ? "done" : runStatus === "aborted" ? "aborted" : "error";

      let terminalReason: string | null = null;
      try {
        const [runRow] = await db
          .select({ terminalReason: agentRuns.terminalReason })
          .from(agentRuns)
          .where(eq(agentRuns.id, runId))
          .limit(1);
        terminalReason = runRow?.terminalReason ?? null;
      } catch { /* best-effort */ }

      syntheticTerminal = JSON.stringify({
        type: syntheticType,
        message: "Run already finished",
        synthetic: true,
        ...(terminalReason ? { terminalReason } : {}),
      });
    }
  }

  return streamSSE(c, async (stream) => {
    let closed = false;

    const cleanup = async () => {
      closed = true;
      await sub?.unsubscribe().catch(() => {});
      cmd.disconnect();
    };

    stream.onAbort(() => void cleanup());

    // Step 3: Replay history with SSE id fields
    for (const entry of historyEntries) {
      if (closed) return;
      const normalized = normalizePayload(entry.payload);
      await stream.writeSSE({ id: entry.id, data: normalized });
      if (checkTerminal(entry.payload)) {
        await cleanup();
        return;
      }
    }

    if (syntheticTerminal) {
      await stream.writeSSE({ data: normalizePayload(syntheticTerminal) });
      await cleanup();
      return;
    }

    // Step 4: Flush buffered pub/sub messages, deduplicating by stream ID
    draining = true;
    for (const buffered of pubsubBuffer) {
      if (closed) return;
      if (buffered.sid && lastHistoryId && buffered.sid <= lastHistoryId) continue;
      const sseId = buffered.sid ?? undefined;
      const normalized = normalizePayload(buffered.payload);
      await stream.writeSSE({ id: sseId, data: normalized });
      if (checkTerminal(buffered.payload)) {
        await cleanup();
        return;
      }
    }
    pubsubBuffer.length = 0;

    // Step 5: Switch pub/sub handler from buffering to live-writing
    const liveSub = await subscribeToRun(runId, (message) => {
      if (closed) return;
      let sid: string | null = null;
      try {
        const parsed = JSON.parse(message) as { _sid?: string };
        sid = parsed._sid ?? null;
      } catch { /* use null sid */ }
      const sseId = sid ?? undefined;
      const normalized = normalizePayload(message);
      stream.writeSSE({ id: sseId, data: normalized }).catch(() => {});
      if (checkTerminal(message)) {
        clearInterval(keepAlive);
        void cleanup();
      }
    });

    // Remove the buffering handler
    await sub?.unsubscribe().catch(() => {});
    sub = liveSub;

    const keepAlive = setInterval(async () => {
      if (closed) return;
      try {
        await stream.writeSSE({ event: "ping", data: "" });
      } catch {
        clearInterval(keepAlive);
        await cleanup();
      }
    }, KEEPALIVE_MS);

    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (closed) {
          clearInterval(check);
          clearInterval(keepAlive);
          resolve();
        }
      }, 1000);
      stream.onAbort(() => {
        clearInterval(check);
        clearInterval(keepAlive);
        resolve();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// GET /inbox — inbox count polling stream
// ---------------------------------------------------------------------------

streamRoutes.get("/inbox", async (c) => {
  const auth = c.get("auth");

  return streamSSE(c, async (stream) => {
    let closed = false;
    let lastCount = -1;

    stream.onAbort(() => { closed = true; });

    async function checkCount() {
      if (closed) return;
      try {
        const db = getPlatform().db;
        const [result] = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(prEvents)
          .where(
            and(
              eq(prEvents.userId, auth.userId),
              eq(prEvents.actionNeeded, true),
              eq(prEvents.read, false),
            ),
          );
        const count = result?.count ?? 0;
        if (count !== lastCount) {
          lastCount = count;
          await stream.writeSSE({ event: "count", data: JSON.stringify({ count }) });
        }
      } catch { /* skip this cycle */ }
    }

    await checkCount();

    const pollTimer = setInterval(checkCount, INBOX_POLL_MS);
    const heartbeatTimer = setInterval(async () => {
      if (closed) return;
      try {
        await stream.writeSSE({ event: "heartbeat", data: "{}" });
      } catch {
        closed = true;
      }
    }, INBOX_HEARTBEAT_MS);

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        resolve();
      });
    });
  });
});

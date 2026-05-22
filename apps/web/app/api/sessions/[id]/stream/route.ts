import { NextRequest } from "next/server";
import Redis from "ioredis";
import { eq, and, desc } from "drizzle-orm";
import { sessions, chats } from "@coding-agents/db";
import {
  readRunEventHistoryDetailed,
  readRunEventEntriesAfterId,
} from "@coding-agents/platform";
import { normalizeEvent, isTerminalEvent as isTerminalEventCheck } from "@coding-agents/shared";
import { requireForgeAuth, getPlatform } from "@/lib/platform";
import { getRedisUrl } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 25_000;

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

type MessageHandler = (message: string) => void;
let sharedSub: Redis | null = null;
const channelListeners = new Map<string, Set<MessageHandler>>();

function ensureSharedSub(): Redis {
  if (sharedSub) return sharedSub;
  const url = getRedisUrl();
  if (!url) throw new Error("REDIS_URL is required");
  const normalized = url.includes("://") ? url : `redis://${url}`;
  sharedSub = new Redis(normalized, {
    connectionName: "web-sse-sub",
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
    console.error("[web-sse] Redis sub error:", err.message);
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

function newRedisCmd(sessionId: string): Redis {
  const url = getRedisUrl();
  if (!url) throw new Error("REDIS_URL is required");
  const normalized = url.includes("://") ? url : `redis://${url}`;
  return new Redis(normalized, {
    connectionName: `web-sse-cmd-${sessionId}`,
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let auth;
  try {
    auth = await requireForgeAuth();
  } catch (err) {
    if (err instanceof Response) return err;
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Unauthorized" })}\n\n`,
      { status: 401, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const { id: sessionId } = await params;
  const lastEventId =
    req.headers.get("Last-Event-ID") ??
    req.nextUrl.searchParams.get("lastEventId") ??
    null;
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

  if (!sessionRow) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", message: "Session not found" })}\n\n`,
      { status: 404, headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const runId = chatRow?.activeRunId;

  if (!runId) {
    return new Response(
      `data: ${JSON.stringify({ type: "no_active_run" })}\n\n`,
      { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } },
    );
  }

  const cmd = newRedisCmd(sessionId);

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
    return new Response(
      `data: ${JSON.stringify({ type: "error", code: "STREAM_INTERRUPTED", retryable: true })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }

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
    return new Response(
      `data: ${JSON.stringify({ type: "error", code: "REPLAY_FAILED", retryable: true })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    );
  }

  const lastHistoryId = historyEntries.length > 0
    ? historyEntries[historyEntries.length - 1]!.id
    : lastEventId;

  let syntheticTerminal: string | null = null;
  const hasTerminal = historyEntries.some((e) => checkTerminal(e.payload));
  if (!hasTerminal) {
    const runStatus = await cmd.get(`run:${runId}:status`).catch(() => null);
    if (runStatus === "completed" || runStatus === "failed" || runStatus === "aborted") {
      const syntheticType =
        runStatus === "completed" ? "done" : runStatus === "aborted" ? "aborted" : "error";
      syntheticTerminal = JSON.stringify({
        type: syntheticType, message: "Run already finished", synthetic: true,
      });
    }
  }

  const encoder = new TextEncoder();
  let closed = false;

  const cleanup = async () => {
    closed = true;
    await sub?.unsubscribe().catch(() => {});
    cmd.disconnect();
  };

  const stream = new ReadableStream({
    async start(controller) {
      const write = (id: string | undefined, data: string) => {
        if (closed) return;
        let frame = "";
        if (id) frame += `id: ${id}\n`;
        frame += `data: ${data}\n\n`;
        try { controller.enqueue(encoder.encode(frame)); } catch { closed = true; }
      };

      for (const entry of historyEntries) {
        if (closed) { await cleanup(); return; }
        write(entry.id, normalizePayload(entry.payload));
        if (checkTerminal(entry.payload)) {
          await cleanup();
          controller.close();
          return;
        }
      }

      if (syntheticTerminal) {
        write(undefined, normalizePayload(syntheticTerminal));
        await cleanup();
        controller.close();
        return;
      }

      draining = true;
      for (const buffered of pubsubBuffer) {
        if (closed) { await cleanup(); return; }
        if (buffered.sid && lastHistoryId && buffered.sid <= lastHistoryId) continue;
        write(buffered.sid ?? undefined, normalizePayload(buffered.payload));
        if (checkTerminal(buffered.payload)) {
          await cleanup();
          controller.close();
          return;
        }
      }
      pubsubBuffer.length = 0;

      const liveSub = await subscribeToRun(runId, (message) => {
        if (closed) return;
        let sid: string | null = null;
        try {
          const parsed = JSON.parse(message) as { _sid?: string };
          sid = parsed._sid ?? null;
        } catch { /* use null sid */ }
        write(sid ?? undefined, normalizePayload(message));
        if (checkTerminal(message)) {
          clearInterval(keepAlive);
          void cleanup().then(() => {
            try { controller.close(); } catch { /* already closed */ }
          });
        }
      });
      await sub?.unsubscribe().catch(() => {});
      sub = liveSub;

      const keepAlive = setInterval(() => {
        if (closed) { clearInterval(keepAlive); return; }
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(keepAlive);
          void cleanup();
        }
      }, KEEPALIVE_MS);
    },
    cancel() {
      void cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

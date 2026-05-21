import { describe, it, expect, mock, beforeAll } from "bun:test";

mock.module("@coding-agents/db", () => ({
  agentEvents: {
    id: "id",
    runId: "run_id",
    sessionId: "session_id",
    seriesId: "series_id",
    parentEventId: "parent_event_id",
    eventType: "event_type",
    status: "status",
    startedAt: "started_at",
    endedAt: "ended_at",
    durationMs: "duration_ms",
    metadata: "metadata",
    createdAt: "created_at",
  },
  eventSeries: {
    id: "id",
    sessionId: "session_id",
    eventType: "event_type",
    createdAt: "created_at",
  },
  sessions: {
    id: "id",
    userId: "user_id",
  },
  OBSERVABILITY_EVENT_TYPES: [
    "llm_request",
    "tool_call",
    "sandbox_exec",
    "error",
    "system",
  ],
  OBSERVABILITY_EVENT_STATUSES: [
    "running",
    "success",
    "error",
    "timeout",
    "interrupted",
  ],
}));

let ObservabilityService: typeof import("../../packages/platform/src/services/observability").ObservabilityService;
beforeAll(async () => {
  const mod = await import("../../packages/platform/src/services/observability");
  ObservabilityService = mod.ObservabilityService;
});

function createMockDb(options: {
  sessionOwner?: string;
  queryResults?: unknown[];
  seriesId?: number;
} = {}) {
  const { sessionOwner = "user-1", queryResults = [], seriesId = 1 } = options;
  const insertedBatches: unknown[][] = [];
  let selectCallIndex = 0;

  const db = {
    insert: () => {
      const insertResult = {
        values: (rows: unknown | unknown[]) => {
          const arr = Array.isArray(rows) ? rows : [rows];
          insertedBatches.push(arr);
          return insertResult;
        },
        onConflictDoUpdate: () => insertResult,
        returning: () => Promise.resolve([{ id: seriesId }]),
        then(resolve: (v: unknown) => void) {
          resolve(undefined);
          return Promise.resolve();
        },
      };
      return insertResult;
    },
    select: () => {
      const currentCall = selectCallIndex++;
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        groupBy: () => chain,
        limit: () => {
          // First select call = resolveSeriesId (return empty to trigger insert)
          // Second+ select calls = assertSessionAccess
          if (currentCall === 0) return Promise.resolve([]);
          return Promise.resolve(sessionOwner ? [{ id: "session-1" }] : []);
        },
        then(resolve: (v: unknown) => void) {
          resolve(queryResults);
          return Promise.resolve();
        },
      };
      return chain;
    },
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve([]),
      }),
    }),
    execute: () => Promise.resolve([]),
    _insertedBatches: insertedBatches,
  };

  return db as unknown;
}

describe("ObservabilityService", () => {
  describe("recordBatch", () => {
    it("resolves series id and inserts events", async () => {
      const db = createMockDb();
      const service = new ObservabilityService(db as any);

      await service.recordBatch([
        {
          id: "evt-1",
          runId: "run-1",
          sessionId: "session-1",
          parentEventId: null,
          eventType: "llm_request",
          status: "success",
          startedAt: new Date(),
          endedAt: new Date(),
          durationMs: 100,
          metadata: { model: "claude-sonnet-4" },
        },
      ]);

      // 2 inserts: one for eventSeries (resolveSeriesId), one for agentEvents
      expect((db as any)._insertedBatches.length).toBe(2);
      const eventsBatch = (db as any)._insertedBatches[1];
      expect(eventsBatch.length).toBe(1);
      expect(eventsBatch[0].seriesId).toBe(1);
      expect(eventsBatch[0].eventType).toBe("llm_request");
    });

    it("does nothing for empty array", async () => {
      const db = createMockDb();
      const service = new ObservabilityService(db as any);
      await service.recordBatch([]);
      expect((db as any)._insertedBatches.length).toBe(0);
    });

    it("uses provided seriesId when available", async () => {
      const db = createMockDb();
      const service = new ObservabilityService(db as any);

      await service.recordBatch([
        {
          id: "evt-2",
          runId: "run-1",
          sessionId: "session-1",
          seriesId: 42,
          parentEventId: null,
          eventType: "tool_call",
          status: "success",
          startedAt: new Date(),
          endedAt: new Date(),
          durationMs: 50,
          metadata: {},
        },
      ]);

      expect((db as any)._insertedBatches[0][0].seriesId).toBe(42);
    });
  });

  describe("runRetention", () => {
    it("returns deleted count", async () => {
      const db = createMockDb();
      const service = new ObservabilityService(db as any);
      const result = await service.runRetention(30);
      expect(result.deleted).toBe(0);
    });
  });
});

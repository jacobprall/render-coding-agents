import { describe, it, expect, mock, beforeAll } from "bun:test";

let agentRuns: unknown;
let chats: unknown;
let sessions: unknown;
let mergeToolResults: typeof import("../src/run-persistence").mergeToolResults;
let finalizeRun: typeof import("../src/run-persistence").finalizeRun;
type AssistantPart = import("../src/types").AssistantPart;

beforeAll(async () => {
  const dbMod = await import("@coding-agents/db");
  agentRuns = dbMod.agentRuns;
  chats = dbMod.chats;
  sessions = dbMod.sessions;
  const mod = await import("../src/run-persistence");
  mergeToolResults = mod.mergeToolResults;
  finalizeRun = mod.finalizeRun;
});

type UpdateRecord = { table: unknown; data: Record<string, unknown> };

function createMockDb(options?: { startedAt?: Date | null }) {
  const updates: UpdateRecord[] = [];
  const startedAt = options?.startedAt ?? new Date(Date.now() - 60_000);

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(startedAt != null ? [{ startedAt }] : []),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (data: Record<string, unknown>) => ({
        where: () => {
          updates.push({ table, data });
          return Promise.resolve();
        },
      }),
    }),
    _updates: updates,
  };

  return db;
}

function createMockEvents() {
  const publish = mock(async (_runId: string, _payload: string) => {});
  const setKey = mock(async (_key: string, _value: string, _ttl: number) => {});
  return { publish, setKey };
}

describe("mergeToolResults", () => {
  it("merges matched tool_call and tool_result", () => {
    const parts: AssistantPart[] = [
      { type: "tool_call", toolCallId: "call-1", name: "bash", args: { command: "ls" } },
      { type: "tool_result", toolCallId: "call-1", result: "file.txt" },
    ];

    const merged = mergeToolResults(parts);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      type: "tool_call",
      toolCallId: "call-1",
      name: "bash",
      result: "file.txt",
    });
  });

  it("appends unmatched tool_result instead of dropping it", () => {
    const parts: AssistantPart[] = [
      { type: "tool_result", toolCallId: "orphan-1", result: "no matching call" },
    ];

    const merged = mergeToolResults(parts);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      type: "tool_result",
      toolCallId: "orphan-1",
      result: "no matching call",
    });
  });

  it("passes text parts through unchanged", () => {
    const parts: AssistantPart[] = [
      { type: "text", text: "Hello" },
      { type: "text", text: "World" },
    ];

    const merged = mergeToolResults(parts);
    expect(merged).toEqual(parts);
  });

  it("handles tool_result before tool_call", () => {
    const parts: AssistantPart[] = [
      { type: "tool_result", toolCallId: "call-early", result: "early result" },
      { type: "tool_call", toolCallId: "call-early", name: "read_file", args: { path: "/tmp/x" } },
    ];

    const merged = mergeToolResults(parts);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      type: "tool_result",
      toolCallId: "call-early",
      result: "early result",
    });
    expect(merged[1]).toMatchObject({
      type: "tool_call",
      toolCallId: "call-early",
      name: "read_file",
    });
    expect(merged[1].result).toBeUndefined();
  });

  it("merges result into the latest tool_call for duplicate toolCallId", () => {
    const parts: AssistantPart[] = [
      { type: "tool_call", toolCallId: "dup-1", name: "bash", args: { command: "first" } },
      { type: "tool_call", toolCallId: "dup-1", name: "bash", args: { command: "second" } },
      { type: "tool_result", toolCallId: "dup-1", result: "second output" },
    ];

    const merged = mergeToolResults(parts);
    expect(merged).toHaveLength(2);
    expect(merged[0].result).toBeUndefined();
    expect(merged[1]).toMatchObject({
      type: "tool_call",
      toolCallId: "dup-1",
      args: { command: "second" },
      result: "second output",
    });
  });
});

describe("finalizeRun", () => {
  const baseParams = {
    runId: "run-1",
    chatId: "chat-1",
    sessionId: "session-1",
  };

  it("sets correct status, finishedAt, terminalReason, and totalDurationMs on agentRuns", async () => {
    const startedAt = new Date(Date.now() - 120_000);
    const db = createMockDb({ startedAt });

    await finalizeRun({
      db: db as never,
      ...baseParams,
      status: "error",
      terminalReason: "worker_lost",
    });

    const runUpdate = db._updates.find((u) => u.table === agentRuns);
    expect(runUpdate).toBeDefined();
    expect(runUpdate!.data.status).toBe("error");
    expect(runUpdate!.data.terminalReason).toBe("worker_lost");
    expect(runUpdate!.data.finishedAt).toBeInstanceOf(Date);
    expect(runUpdate!.data.totalDurationMs).toBeGreaterThanOrEqual(120_000);
  });

  it("nulls out chats.activeRunId", async () => {
    const db = createMockDb();

    await finalizeRun({
      db: db as never,
      ...baseParams,
      status: "completed",
    });

    const chatUpdate = db._updates.find((u) => u.table === chats);
    expect(chatUpdate).toBeDefined();
    expect(chatUpdate!.data.activeRunId).toBeNull();
    expect(chatUpdate!.data.updatedAt).toBeInstanceOf(Date);
  });

  it("updates session status to failed for error runs and completed for success", async () => {
    const db = createMockDb();

    await finalizeRun({
      db: db as never,
      ...baseParams,
      status: "error",
    });

    const sessionUpdate = db._updates.find((u) => u.table === sessions);
    expect(sessionUpdate).toBeDefined();
    expect(sessionUpdate!.data.status).toBe("failed");
    expect(sessionUpdate!.data.lastActivityAt).toBeInstanceOf(Date);
    expect(sessionUpdate!.data.updatedAt).toBeInstanceOf(Date);

    db._updates.length = 0;

    await finalizeRun({
      db: db as never,
      ...baseParams,
      status: "completed",
    });

    const completedSessionUpdate = db._updates.find((u) => u.table === sessions);
    expect(completedSessionUpdate!.data.status).toBe("completed");
  });

  it("publishes the event and sets the status key when eventPayload is provided", async () => {
    const db = createMockDb();
    const events = createMockEvents();

    await finalizeRun({
      db: db as never,
      events: events as never,
      ...baseParams,
      status: "error",
      eventType: "error",
      eventPayload: {
        code: "STALE_RUN",
        message: "Agent run lost (no heartbeat)",
        retryable: false,
        terminalReason: "worker_lost",
      },
      statusTtl: 7200,
    });

    expect(events.publish).toHaveBeenCalledTimes(1);
    expect(events.publish).toHaveBeenCalledWith(
      "run-1",
      JSON.stringify({
        type: "error",
        code: "STALE_RUN",
        message: "Agent run lost (no heartbeat)",
        retryable: false,
        terminalReason: "worker_lost",
      }),
    );

    expect(events.setKey).toHaveBeenCalledTimes(1);
    expect(events.setKey).toHaveBeenCalledWith("run:run-1:status", "error", 7200);
  });

  it("skips event publish when eventPayload is omitted", async () => {
    const db = createMockDb();
    const events = createMockEvents();

    await finalizeRun({
      db: db as never,
      events: events as never,
      ...baseParams,
      status: "completed",
    });

    expect(events.publish).not.toHaveBeenCalled();
    expect(events.setKey).not.toHaveBeenCalled();
  });

  it("includes usage tokens in agentRuns update when provided", async () => {
    const db = createMockDb();

    await finalizeRun({
      db: db as never,
      ...baseParams,
      status: "completed",
      usage: { promptTokens: 100, completionTokens: 50 },
    });

    const runUpdate = db._updates.find((u) => u.table === agentRuns);
    expect(runUpdate!.data.promptTokens).toBe(100);
    expect(runUpdate!.data.completionTokens).toBe(50);
  });
});

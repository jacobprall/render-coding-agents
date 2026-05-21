import { describe, it, expect, mock, beforeEach, afterEach, beforeAll } from "bun:test";

mock.module("@coding-agents/platform", () => ({
  DEFAULT_POLICY: {
    credentials: [
      { pattern: /sk-[a-zA-Z0-9]+/, replacement: "[REDACTED]" },
    ],
  },
  OtlpExporter: class MockOtlpExporter {
    async exportBatch() {}
  },
  redactCredentials: (value: string) => value.replace(/sk-[a-zA-Z0-9-]+/g, "[REDACTED]"),
}));

mock.module("@coding-agents/db", () => ({
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

let ObservabilityRecorder: typeof import("../../apps/agent/src/observability").ObservabilityRecorder;
beforeAll(async () => {
  const mod = await import("../../apps/agent/src/observability");
  ObservabilityRecorder = mod.ObservabilityRecorder;
});

function createMockPlatform() {
  const recorded: unknown[][] = [];
  return {
    observability: {
      recordBatch: async (events: unknown[]) => {
        recorded.push(events);
      },
    },
    _recorded: recorded,
  };
}

describe("ObservabilityRecorder", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      OBSERVABILITY_EVENT_CAP: process.env.OBSERVABILITY_EVENT_CAP,
      OBSERVABILITY_FLUSH_INTERVAL_MS: process.env.OBSERVABILITY_FLUSH_INTERVAL_MS,
      OBSERVABILITY_BATCH_SIZE: process.env.OBSERVABILITY_BATCH_SIZE,
      OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    };
    process.env.OBSERVABILITY_FLUSH_INTERVAL_MS = "50";
    process.env.OBSERVABILITY_BATCH_SIZE = "5";
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("records and flushes events on close", async () => {
    const platform = createMockPlatform();
    const recorder = new ObservabilityRecorder({
      platform: platform as any,
      sessionId: "sess-1",
      runId: "run-1",
      userId: "user-1",
    });

    const handle = recorder.startEvent("llm_request", { model: "test" });
    expect(handle).not.toBeNull();
    recorder.endEvent(handle, "success", { tokens: { input: 100, output: 50 } });

    await recorder.close();
    expect(platform._recorded.length).toBeGreaterThan(0);
    const flushed = platform._recorded.flat();
    expect(flushed.length).toBe(1);
    expect((flushed[0] as any).eventType).toBe("llm_request");
    expect((flushed[0] as any).status).toBe("success");
  });

  it("respects event cap", async () => {
    process.env.OBSERVABILITY_EVENT_CAP = "3";

    const platform = createMockPlatform();
    const recorder = new ObservabilityRecorder({
      platform: platform as any,
      sessionId: "sess-2",
      runId: "run-2",
      userId: "user-2",
    });

    for (let i = 0; i < 10; i++) {
      const h = recorder.startEvent("tool_call", { toolName: `tool-${i}` });
      recorder.endEvent(h, "success");
    }

    await recorder.close();
    const total = platform._recorded.flat().length;
    expect(total).toBeLessThanOrEqual(3);
  });

  it("returns null handle when cap is reached", async () => {
    process.env.OBSERVABILITY_EVENT_CAP = "1";

    const platform = createMockPlatform();
    const recorder = new ObservabilityRecorder({
      platform: platform as any,
      sessionId: "sess-3",
      runId: "run-3",
      userId: "user-3",
    });

    const h1 = recorder.startEvent("llm_request", {});
    recorder.endEvent(h1, "success");

    const h2 = recorder.startEvent("llm_request", {});
    expect(h2).toBeNull();

    await recorder.close();
  });

  it("redacts secret-looking keys from metadata", async () => {
    const platform = createMockPlatform();
    const recorder = new ObservabilityRecorder({
      platform: platform as any,
      sessionId: "sess-4",
      runId: "run-4",
      userId: "user-4",
    });

    const handle = recorder.startEvent("llm_request", {
      api_key: "sk-secret-123",
      model: "claude-sonnet-4",
    });
    recorder.endEvent(handle, "success");

    await recorder.close();
    const event = platform._recorded.flat()[0] as any;
    expect(event.metadata.api_key).toBe("[REDACTED]");
    expect(event.metadata.model).toBe("claude-sonnet-4");
  });

  it("records sandbox events for sandbox tool names", async () => {
    const platform = createMockPlatform();
    const recorder = new ObservabilityRecorder({
      platform: platform as any,
      sessionId: "sess-5",
      runId: "run-5",
      userId: "user-5",
    });

    recorder.maybeRecordSandboxEvent("parent-1", "bash", "success", { command: "ls" });
    recorder.maybeRecordSandboxEvent("parent-1", "unknown_tool", "success", {});

    await recorder.close();
    const events = platform._recorded.flat();
    expect(events.length).toBe(1);
    expect((events[0] as any).eventType).toBe("sandbox_exec");
  });

  it("flushes automatically when batch size is reached", async () => {
    process.env.OBSERVABILITY_BATCH_SIZE = "2";

    const platform = createMockPlatform();
    const recorder = new ObservabilityRecorder({
      platform: platform as any,
      sessionId: "sess-6",
      runId: "run-6",
      userId: "user-6",
    });

    const h1 = recorder.startEvent("llm_request", {});
    recorder.endEvent(h1, "success");
    const h2 = recorder.startEvent("tool_call", {});
    recorder.endEvent(h2, "success");

    await new Promise((r) => setTimeout(r, 20));
    expect(platform._recorded.length).toBeGreaterThan(0);

    await recorder.close();
  });
});

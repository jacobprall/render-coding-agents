import { describe, it, expect, mock, beforeEach, afterEach, beforeAll } from "bun:test";

let exportBatchImpl: (spans: unknown[]) => Promise<void> = async () => {};

const realPlatform = await import("@coding-agents/platform");
mock.module("@coding-agents/platform", () => ({
  ...realPlatform,
  OtlpExporter: class MockOtlpExporter {
    async exportBatch(spans: unknown[]) {
      await exportBatchImpl(spans);
    }
  },
  redactCredentials: (value: string) => value.replace(/sk-[a-zA-Z0-9-]+/g, "[REDACTED]"),
}));

let ObservabilityRecorder: typeof import("../src/observability").ObservabilityRecorder;

beforeAll(async () => {
  const mod = await import("../src/observability");
  ObservabilityRecorder = mod.ObservabilityRecorder;
});

function createMockPlatform(options?: {
  recordBatch?: (events: unknown[]) => Promise<void>;
}) {
  const recorded: unknown[][] = [];
  return {
    observability: {
      recordBatch:
        options?.recordBatch ??
        (async (events: unknown[]) => {
          recorded.push(events);
        }),
    },
    _recorded: recorded,
  };
}

describe("ObservabilityRecorder flushNow", () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    exportBatchImpl = async () => {};
    originalEnv = {
      OBSERVABILITY_EVENT_CAP: process.env.OBSERVABILITY_EVENT_CAP,
      OBSERVABILITY_FLUSH_INTERVAL_MS: process.env.OBSERVABILITY_FLUSH_INTERVAL_MS,
      OBSERVABILITY_BATCH_SIZE: process.env.OBSERVABILITY_BATCH_SIZE,
      OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    };
    process.env.OBSERVABILITY_FLUSH_INTERVAL_MS = "5000";
    process.env.OBSERVABILITY_BATCH_SIZE = "100";
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(originalEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  it("removes items from queue on successful flush", async () => {
    const platform = createMockPlatform();
    const recorder = new ObservabilityRecorder({
      platform: platform as any,
      sessionId: "sess-1",
      runId: "run-1",
      userId: "user-1",
    });

    const handle = recorder.startEvent("llm_request", { model: "test" });
    recorder.endEvent(handle, "success");

    await recorder.close();
    expect(platform._recorded.flat().length).toBe(1);

    platform._recorded.length = 0;
    await recorder.close();
    expect(platform._recorded.flat().length).toBe(0);
  });

  it("keeps items in queue when recordBatch fails", async () => {
    let attempts = 0;
    const platform = createMockPlatform({
      recordBatch: async (events) => {
        attempts += 1;
        if (attempts === 1) throw new Error("persist failed");
        platform._recorded.push(events);
      },
    });

    const recorder = new ObservabilityRecorder({
      platform: platform as any,
      sessionId: "sess-2",
      runId: "run-2",
      userId: "user-2",
    });

    const handle = recorder.startEvent("tool_call", { toolName: "bash" });
    recorder.endEvent(handle, "success");

    await recorder.close();
    expect(platform._recorded.flat().length).toBe(0);

    await recorder.close();
    const flushed = platform._recorded.flat();
    expect(flushed.length).toBe(1);
    expect((flushed[0] as any).eventType).toBe("tool_call");
  });

  it("keeps spans in queue when exportBatch fails", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://localhost:4318/v1/traces";

    let exportAttempts = 0;
    exportBatchImpl = async () => {
      exportAttempts += 1;
      if (exportAttempts === 1) throw new Error("export failed");
    };

    const platform = createMockPlatform();
    const recorder = new ObservabilityRecorder({
      platform: platform as any,
      sessionId: "sess-3",
      runId: "run-3",
      userId: "user-3",
    });

    const handle = recorder.startEvent("llm_request", { model: "test" });
    recorder.endEvent(handle, "success");

    await recorder.close();
    expect(exportAttempts).toBe(1);
    expect(platform._recorded.flat().length).toBe(1);

    await recorder.close();
    expect(exportAttempts).toBe(2);
  });

  it("retries previously-failed items on subsequent flush", async () => {
    let attempts = 0;
    const platform = createMockPlatform({
      recordBatch: async (events) => {
        attempts += 1;
        if (attempts < 3) throw new Error(`fail ${attempts}`);
        platform._recorded.push(events);
      },
    });

    const recorder = new ObservabilityRecorder({
      platform: platform as any,
      sessionId: "sess-4",
      runId: "run-4",
      userId: "user-4",
    });

    const h1 = recorder.startEvent("llm_request", { step: 1 });
    recorder.endEvent(h1, "success");
    const h2 = recorder.startEvent("tool_call", { step: 2 });
    recorder.endEvent(h2, "success");

    await recorder.close();
    expect(platform._recorded.flat().length).toBe(0);

    await recorder.close();
    expect(platform._recorded.flat().length).toBe(0);

    await recorder.close();
    const flushed = platform._recorded.flat();
    expect(flushed.length).toBe(2);
    expect((flushed[0] as any).metadata.step).toBe(1);
    expect((flushed[1] as any).metadata.step).toBe(2);
  });
});

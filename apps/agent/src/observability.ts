import { nanoid } from "nanoid";
import {
  DEFAULT_POLICY,
  type NewAgentEventInput,
  OtlpExporter,
  redactCredentials,
  type PlatformContainer,
} from "@coding-agents/platform";
import type {
  ObservabilityEventStatus,
  ObservabilityEventType,
} from "@coding-agents/db";

type JsonLike = Record<string, unknown>;

const DEFAULT_FLUSH_INTERVAL_MS = 500;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_EVENT_CAP = 10_000;
const DEFAULT_METADATA_MAX_BYTES = 4_096;
const WARNING_THRESHOLD_RATIO = 0.8;

const SANDBOX_TOOL_NAMES = new Set([
  "bash",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "git",
]);

export interface ObservabilityRecorderOptions {
  platform: PlatformContainer;
  sessionId: string;
  runId: string;
  userId: string;
}

export interface EventHandle {
  id: string;
  parentEventId?: string;
  eventType: ObservabilityEventType;
  startedAt: Date;
  metadata: JsonLike;
}

export class ObservabilityRecorder {
  private readonly eventCap: number;
  private readonly metadataMaxBytes: number;
  private readonly flushIntervalMs: number;
  private readonly batchSize: number;
  private readonly platform: PlatformContainer;
  private readonly sessionId: string;
  private readonly runId: string;
  private readonly userId: string;
  private readonly traceId: string;
  private readonly otlpExporter?: OtlpExporter;
  private readonly otelHeaders: Record<string, string>;
  private readonly queue: NewAgentEventInput[] = [];
  private readonly spans: Array<Parameters<OtlpExporter["exportBatch"]>[0][number]> = [];

  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight = false;
  private recordedCount = 0;
  private warningEmitted = false;

  constructor(options: ObservabilityRecorderOptions) {
    this.platform = options.platform;
    this.sessionId = options.sessionId;
    this.runId = options.runId;
    this.userId = options.userId;
    this.traceId = createTraceId();
    this.eventCap = parseInt(process.env.OBSERVABILITY_EVENT_CAP ?? String(DEFAULT_EVENT_CAP), 10);
    this.metadataMaxBytes = parseInt(
      process.env.OBSERVABILITY_METADATA_MAX_BYTES ?? String(DEFAULT_METADATA_MAX_BYTES),
      10,
    );
    this.flushIntervalMs = parseInt(
      process.env.OBSERVABILITY_FLUSH_INTERVAL_MS ?? String(DEFAULT_FLUSH_INTERVAL_MS),
      10,
    );
    this.batchSize = parseInt(process.env.OBSERVABILITY_BATCH_SIZE ?? String(DEFAULT_BATCH_SIZE), 10);
    this.otelHeaders = parseOtelHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS ?? "");

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    if (endpoint) {
      this.otlpExporter = new OtlpExporter({
        endpoint,
        serviceName: process.env.OTEL_SERVICE_NAME ?? "render-coding-agents-agent",
        headers: this.otelHeaders,
      });
    }
  }

  startEvent(
    eventType: ObservabilityEventType,
    metadata: JsonLike = {},
    parentEventId?: string,
  ): EventHandle | null {
    if (!this.canRecordMore()) return null;
    return {
      id: createEventId(),
      parentEventId,
      eventType,
      startedAt: new Date(),
      metadata,
    };
  }

  endEvent(
    handle: EventHandle | null,
    status: ObservabilityEventStatus,
    metadata: JsonLike = {},
  ): void {
    if (!handle) return;

    const endedAt = new Date();
    const durationMs = Math.max(0, endedAt.getTime() - handle.startedAt.getTime());
    const mergedMetadata = this.sanitizeMetadata({
      ...handle.metadata,
      ...metadata,
      runId: this.runId,
      sessionId: this.sessionId,
      userId: this.userId,
    });

    const eventRow: NewAgentEventInput = {
      id: handle.id,
      runId: this.runId,
      sessionId: this.sessionId,
      parentEventId: handle.parentEventId ?? null,
      eventType: handle.eventType,
      status,
      startedAt: handle.startedAt,
      endedAt,
      durationMs,
      metadata: mergedMetadata,
    };

    this.recordedCount += 1;
    this.queue.push(eventRow);
    this.pushSpan(eventRow);

    if (!this.warningEmitted && this.recordedCount >= Math.floor(this.eventCap * WARNING_THRESHOLD_RATIO)) {
      this.warningEmitted = true;
      const warning = this.startEvent("system", { message: "Event cap threshold reached" }, handle.id);
      this.endEvent(warning, "success", {
        threshold: Math.floor(this.eventCap * WARNING_THRESHOLD_RATIO),
        cap: this.eventCap,
      });
    }

    if (this.queue.length >= this.batchSize) {
      void this.flushNow();
      return;
    }

    this.ensureFlushTimer();
  }

  maybeRecordSandboxEvent(
    parentEventId: string | undefined,
    toolName: string,
    status: ObservabilityEventStatus,
    metadata: JsonLike,
  ): void {
    if (!SANDBOX_TOOL_NAMES.has(toolName)) return;
    const handle = this.startEvent(
      "sandbox_exec",
      {
        toolName,
        ...metadata,
      },
      parentEventId,
    );
    this.endEvent(handle, status);
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flushNow();
  }

  private canRecordMore(): boolean {
    return this.recordedCount < this.eventCap;
  }

  private ensureFlushTimer() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, this.flushIntervalMs);
  }

  private async flushNow(): Promise<void> {
    if (this.flushInFlight || (this.queue.length === 0 && this.spans.length === 0)) return;
    this.flushInFlight = true;

    const rows = this.queue.splice(0, this.queue.length);
    const spans = this.spans.splice(0, this.spans.length);

    try {
      if (rows.length > 0) {
        await this.platform.observability.recordBatch(rows);
      }
    } catch (error) {
      console.warn("[observability] failed to persist events:", error);
    }

    try {
      if (this.otlpExporter && spans.length > 0) {
        await this.otlpExporter.exportBatch(spans);
      }
    } catch (error) {
      console.warn("[observability] failed to export OTLP spans:", error);
    } finally {
      this.flushInFlight = false;
    }
  }

  private sanitizeMetadata(input: JsonLike): JsonLike {
    const sanitized = sanitizeValue(input, this.metadataMaxBytes);
    if (typeof sanitized === "object" && sanitized && !Array.isArray(sanitized)) {
      return sanitized as JsonLike;
    }
    return { value: sanitized };
  }

  private pushSpan(eventRow: NewAgentEventInput): void {
    if (!this.otlpExporter || !eventRow.endedAt) return;

    const attributes = flattenAttributes(eventRow.metadata ?? {});
    this.spans.push({
      id: toSpanId(eventRow.id),
      traceId: this.traceId,
      parentId: eventRow.parentEventId ? toSpanId(eventRow.parentEventId) : undefined,
      name: eventRow.eventType,
      startTimeUnixNano: toUnixNano(eventRow.startedAt),
      endTimeUnixNano: toUnixNano(eventRow.endedAt),
      attributes,
      statusCode: eventRow.status === "error" ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK",
      statusMessage: eventRow.status === "error" ? "event failed" : undefined,
    });
  }
}

function createEventId(): string {
  return `${Date.now()}_${nanoid(10)}`;
}

function createTraceId(): string {
  const value = `${Date.now().toString(16)}${nanoid(24)}`.replace(/[^a-f0-9]/gi, "a");
  return value.slice(0, 32).padEnd(32, "0");
}

function toSpanId(id: string): string {
  const compact = id.replace(/[^a-f0-9]/gi, "a");
  return compact.slice(0, 16).padEnd(16, "0");
}

function toUnixNano(date: Date): string {
  return `${BigInt(date.getTime()) * 1_000_000n}`;
}

function parseOtelHeaders(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((acc, entry) => {
      const [key, ...rest] = entry.split("=");
      if (!key || rest.length === 0) return acc;
      acc[key.trim()] = rest.join("=").trim();
      return acc;
    }, {});
}

function flattenAttributes(input: Record<string, unknown>): Array<{ key: string; value: string | number | boolean }> {
  const attrs: Array<{ key: string; value: string | number | boolean }> = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      attrs.push({ key, value });
      continue;
    }
    attrs.push({ key, value: JSON.stringify(value) });
  }
  return attrs;
}

function sanitizeValue(value: unknown, maxBytes: number, keyPath = ""): unknown {
  if (value == null) return value;

  if (typeof value === "string") {
    const redacted = redactCredentials(value, DEFAULT_POLICY.credentials);
    return truncateByBytes(redacted, maxBytes);
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, maxBytes, keyPath));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (looksSecretKey(key) || looksSecretKey(keyPath)) {
        result[key] = "[REDACTED]";
        continue;
      }
      result[key] = sanitizeValue(child, maxBytes, key);
    }
    return result;
  }

  return String(value);
}

function looksSecretKey(key: string): boolean {
  return /(?:^|_)(key|secret|token|password)$/i.test(key);
}

function truncateByBytes(input: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(input);
  if (encoded.byteLength <= maxBytes) return input;
  const truncated = encoded.slice(0, Math.max(0, maxBytes - 16));
  const decoded = new TextDecoder().decode(truncated);
  return `${decoded}...[TRUNCATED]`;
}

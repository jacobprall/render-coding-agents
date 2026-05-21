export interface OtlpSpanEvent {
  id: string;
  traceId: string;
  parentId?: string | null;
  name: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: Array<{ key: string; value: string | number | boolean }>;
  statusCode: "STATUS_CODE_OK" | "STATUS_CODE_ERROR";
  statusMessage?: string;
}

interface OtlpExporterOptions {
  endpoint: string;
  serviceName?: string;
  headers?: Record<string, string>;
}

export class OtlpExporter {
  private readonly endpoint: string;
  private readonly serviceName: string;
  private readonly headers: Record<string, string>;

  constructor(options: OtlpExporterOptions) {
    this.endpoint = options.endpoint.endsWith("/v1/traces")
      ? options.endpoint
      : `${options.endpoint.replace(/\/$/, "")}/v1/traces`;
    this.serviceName = options.serviceName || "render-coding-agents-agent";
    this.headers = options.headers ?? {};
  }

  async exportBatch(spans: OtlpSpanEvent[]): Promise<void> {
    if (spans.length === 0) return;

    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: this.serviceName },
              },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "agent-observability" },
              spans: spans.map((span) => ({
                traceId: span.traceId,
                spanId: span.id,
                parentSpanId: span.parentId ?? undefined,
                name: span.name,
                startTimeUnixNano: span.startTimeUnixNano,
                endTimeUnixNano: span.endTimeUnixNano,
                attributes: span.attributes.map((attribute) => ({
                  key: attribute.key,
                  value: this.toOtlpAttributeValue(attribute.value),
                })),
                status: {
                  code: span.statusCode,
                  message: span.statusMessage,
                },
              })),
            },
          ],
        },
      ],
    };

    await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify(payload),
    });
  }

  private toOtlpAttributeValue(value: string | number | boolean) {
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "number") return Number.isInteger(value) ? { intValue: value } : { doubleValue: value };
    return { boolValue: value };
  }
}

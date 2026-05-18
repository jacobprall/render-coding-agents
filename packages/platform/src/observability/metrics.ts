export interface MetricEntry {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

const PROMETHEUS_HISTOGRAM_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
] as const;

const MAX_METRICS = 10_000;

function sortedLabelPart(labels: Record<string, string>): string {
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k] ?? ""}`)
    .join("\x1e");
}

function metricKey(
  kind: "counter" | "gauge" | "histogram",
  name: string,
  labels: Record<string, string>,
): string {
  return `${kind}\x1f${name}\x1f${sortedLabelPart(labels)}`;
}

type StoredMetric =
  | { kind: "counter"; name: string; labels: Record<string, string>; value: number; timestamp: number }
  | { kind: "gauge"; name: string; labels: Record<string, string>; value: number; timestamp: number }
  | {
      kind: "histogram";
      name: string;
      labels: Record<string, string>;
      bucketCounts: number[];
      sum: number;
      count: number;
      timestamp: number;
    };

class MetricsCollector {
  private metrics = new Map<string, StoredMetric>();

  private evictIfNeeded(): void {
    while (this.metrics.size >= MAX_METRICS) {
      const first = this.metrics.keys().next().value;
      if (first === undefined) break;
      this.metrics.delete(first);
    }
  }

  counter(name: string, labels: Record<string, string> = {}): void {
    const key = metricKey("counter", name, labels);
    const existing = this.metrics.get(key);
    if (existing && existing.kind === "counter") {
      existing.value++;
      existing.timestamp = Date.now();
      return;
    }
    this.evictIfNeeded();
    this.metrics.set(key, {
      kind: "counter",
      name,
      labels,
      value: 1,
      timestamp: Date.now(),
    });
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = metricKey("gauge", name, labels);
    const existing = this.metrics.get(key);
    if (existing && existing.kind === "gauge") {
      existing.value = value;
      existing.timestamp = Date.now();
      return;
    }
    this.evictIfNeeded();
    this.metrics.set(key, {
      kind: "gauge",
      name,
      labels,
      value,
      timestamp: Date.now(),
    });
  }

  histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = metricKey("histogram", name, labels);
    const now = Date.now();
    const existing = this.metrics.get(key);
    if (existing && existing.kind === "histogram") {
      for (let i = 0; i < PROMETHEUS_HISTOGRAM_BUCKETS.length; i++) {
        if (value <= PROMETHEUS_HISTOGRAM_BUCKETS[i]) {
          existing.bucketCounts[i]++;
        }
      }
      existing.bucketCounts[existing.bucketCounts.length - 1]++;
      existing.sum += value;
      existing.count++;
      existing.timestamp = now;
      return;
    }
    this.evictIfNeeded();
    const bucketCounts = new Array(PROMETHEUS_HISTOGRAM_BUCKETS.length + 1).fill(0);
    for (let i = 0; i < PROMETHEUS_HISTOGRAM_BUCKETS.length; i++) {
      if (value <= PROMETHEUS_HISTOGRAM_BUCKETS[i]) {
        bucketCounts[i]++;
      }
    }
    bucketCounts[bucketCounts.length - 1]++;
    this.metrics.set(key, {
      kind: "histogram",
      name,
      labels,
      bucketCounts,
      sum: value,
      count: 1,
      timestamp: now,
    });
  }

  getMetrics(): MetricEntry[] {
    const out: MetricEntry[] = [];
    for (const m of this.metrics.values()) {
      if (m.kind === "counter" || m.kind === "gauge") {
        out.push({
          name: m.name,
          value: m.value,
          labels: m.labels,
          timestamp: m.timestamp,
        });
      } else {
        const labelBase = { ...m.labels };
        for (let i = 0; i < PROMETHEUS_HISTOGRAM_BUCKETS.length; i++) {
          out.push({
            name: `${m.name}_bucket`,
            value: m.bucketCounts[i],
            labels: { ...labelBase, le: String(PROMETHEUS_HISTOGRAM_BUCKETS[i]) },
            timestamp: m.timestamp,
          });
        }
        out.push({
          name: `${m.name}_bucket`,
          value: m.bucketCounts[m.bucketCounts.length - 1],
          labels: { ...labelBase, le: "+Inf" },
          timestamp: m.timestamp,
        });
        out.push({
          name: `${m.name}_sum`,
          value: m.sum,
          labels: m.labels,
          timestamp: m.timestamp,
        });
        out.push({
          name: `${m.name}_count`,
          value: m.count,
          labels: m.labels,
          timestamp: m.timestamp,
        });
      }
    }
    return out;
  }

  toPrometheus(): string {
    const lines: string[] = [];
    for (const m of this.metrics.values()) {
      if (m.kind === "counter" || m.kind === "gauge") {
        const labelStr = Object.entries(m.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");
        const labelPart = labelStr ? `{${labelStr}}` : "";
        lines.push(`${m.name}${labelPart} ${m.value} ${m.timestamp}`);
      } else {
        const baseLabelStr = Object.entries(m.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(",");
        const basePart = baseLabelStr ? `${baseLabelStr},` : "";
        for (let i = 0; i < PROMETHEUS_HISTOGRAM_BUCKETS.length; i++) {
          const le = PROMETHEUS_HISTOGRAM_BUCKETS[i];
          lines.push(
            `${m.name}_bucket{${basePart}le="${le}"} ${m.bucketCounts[i]} ${m.timestamp}`,
          );
        }
        lines.push(
          `${m.name}_bucket{${basePart}le="+Inf"} ${m.bucketCounts[m.bucketCounts.length - 1]} ${m.timestamp}`,
        );
        const baseLabel = baseLabelStr ? `{${baseLabelStr}}` : "";
        lines.push(`${m.name}_sum${baseLabel} ${m.sum} ${m.timestamp}`);
        lines.push(`${m.name}_count${baseLabel} ${m.count} ${m.timestamp}`);
      }
    }
    return lines.join("\n");
  }

  reset(): void {
    this.metrics.clear();
  }
}

export const metrics = new MetricsCollector();

"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Activity, ArrowRight, ChevronDown, ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { EventRow } from "@/app/(authenticated)/observability/use-events";

interface UsageBreakdown {
  key: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  llmRequestCount: number;
}

interface UsageData {
  totals: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
  breakdown: UsageBreakdown[];
}

interface EventsResponse {
  items: EventRow[];
  total: number;
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Failed: ${r.status}`);
    return r.json();
  });

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  llm_request: "LLM",
  tool_call: "Tool",
  sandbox_exec: "Sandbox",
  error: "Error",
  system: "System",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function EventItem({ event }: { event: EventRow }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-muted/50"
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground">
          {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-foreground">{event.status}</p>
          <p className="text-[10px] text-muted-foreground">
            {formatRelativeTime(event.createdAt)}
          </p>
        </div>
      </button>
      {expanded && (
        <div className="space-y-1 border-t border-border px-2 py-1.5 text-[10px] text-muted-foreground">
          {event.durationMs != null && (
            <p>
              <span className="font-medium text-foreground">Duration:</span>{" "}
              {formatDuration(event.durationMs)}
            </p>
          )}
          {event.sessionId && (
            <p>
              <span className="font-medium text-foreground">Session:</span>{" "}
              <span className="font-mono">{event.sessionId.slice(0, 8)}</span>
            </p>
          )}
          {event.userName && (
            <p>
              <span className="font-medium text-foreground">User:</span> {event.userName}
            </p>
          )}
          {event.trigger && (
            <p>
              <span className="font-medium text-foreground">Trigger:</span> {event.trigger}
            </p>
          )}
          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer font-medium text-foreground">
                Metadata
              </summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[9px]">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </li>
  );
}

export function ObservabilityMini() {
  const { data: usage, isLoading: usageLoading } = useSWR<UsageData>(
    "/api/observability/usage?groupBy=model",
    fetcher,
    { revalidateOnFocus: false },
  );

  const { data: eventsData, isLoading: eventsLoading } = useSWR<EventsResponse>(
    "/api/observability/events?limit=10",
    fetcher,
    { revalidateOnFocus: false },
  );

  const events = eventsData?.items ?? [];
  const isLoading = usageLoading || eventsLoading;

  if (isLoading) {
    return (
      <div className="space-y-3 p-3">
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse bg-muted" />
          ))}
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  const hasUsage = usage && usage.breakdown.length > 0;
  const hasEvents = events.length > 0;

  if (!hasUsage && !hasEvents) {
    return (
      <div className="p-3">
        <EmptyState
          icon={<Activity className="h-5 w-5" />}
          title="No activity yet"
          description="Events and usage will appear here once agents run."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-3">
        {hasUsage ? (
          <div className="mb-4 grid grid-cols-3 gap-2">
            <div className="border border-border bg-card p-2">
              <div className="text-[10px] font-medium text-muted-foreground">Input</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">
                {formatTokens(usage.totals.inputTokens)}
              </div>
            </div>
            <div className="border border-border bg-card p-2">
              <div className="text-[10px] font-medium text-muted-foreground">Output</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">
                {formatTokens(usage.totals.outputTokens)}
              </div>
            </div>
            <div className="border border-border bg-card p-2">
              <div className="text-[10px] font-medium text-muted-foreground">Cost</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums">
                {formatCost(usage.totals.estimatedCost)}
              </div>
            </div>
          </div>
        ) : null}

        {hasEvents ? (
          <div>
            <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Recent events
            </h3>
            <ul className="space-y-1">
              {events.map((event) => (
                <EventItem key={event.id} event={event} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <Link
          href="/observability"
          className="flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          View all
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

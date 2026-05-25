"use client";

import Link from "next/link";
import { createColumnHelper } from "@tanstack/react-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { ColorBadge as Badge } from "@/components/ui/color-badge";
import type { EventRow } from "./use-events";

const columnHelper = createColumnHelper<EventRow>();

function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  llm_request: "LLM Request",
  tool_call: "Tool Call",
  sandbox_exec: "Sandbox",
  error: "Error",
  system: "System",
};

const EVENT_TYPE_VARIANTS: Record<string, "info" | "neutral" | "success" | "pending" | "failure"> = {
  llm_request: "info",
  tool_call: "neutral",
  sandbox_exec: "neutral",
  error: "failure",
  system: "neutral",
};

const STATUS_MAP: Record<string, string> = {
  running: "running",
  success: "completed",
  error: "failed",
  timeout: "failed",
  interrupted: "aborted",
};

export const columns = [
  columnHelper.accessor("eventType", {
    header: "Type",
    cell: (info) => {
      const val = info.getValue();
      return (
        <Badge variant={EVENT_TYPE_VARIANTS[val] ?? "neutral"}>
          {EVENT_TYPE_LABELS[val] ?? val}
        </Badge>
      );
    },
    size: 120,
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => {
      const val = info.getValue();
      return <StatusBadge status={STATUS_MAP[val] ?? val} label={val} />;
    },
    size: 100,
  }),
  columnHelper.accessor("userName", {
    header: "User",
    cell: (info) => (
      <span className="text-sm text-muted-foreground">
        {info.getValue() ?? "—"}
      </span>
    ),
    size: 100,
    meta: { className: "hidden md:table-cell" },
  }),
  columnHelper.accessor("trigger", {
    header: "Trigger",
    cell: (info) => {
      const val = info.getValue();
      if (!val) return <span className="text-muted-foreground">—</span>;
      return (
        <span className="text-xs text-muted-foreground font-mono">
          {val.replace(/_/g, " ")}
        </span>
      );
    },
    size: 110,
    meta: { className: "hidden md:table-cell" },
  }),
  columnHelper.accessor("durationMs", {
    header: "Duration",
    cell: (info) => (
      <span className="tabular-nums text-sm text-muted-foreground">
        {formatDuration(info.getValue())}
      </span>
    ),
    size: 80,
    meta: { className: "hidden lg:table-cell" },
  }),
  columnHelper.accessor("createdAt", {
    header: "Time",
    cell: (info) => (
      <span className="text-sm text-muted-foreground" title={info.getValue()}>
        {formatRelativeTime(info.getValue())}
      </span>
    ),
    size: 80,
  }),
  columnHelper.accessor("sessionId", {
    header: "Session",
    cell: (info) => (
      <Link
        href={`/sessions/${info.getValue()}`}
        onClick={(e) => e.stopPropagation()}
        className="font-mono text-xs text-primary hover:underline"
      >
        {info.getValue().slice(0, 8)}
      </Link>
    ),
    size: 80,
  }),
];

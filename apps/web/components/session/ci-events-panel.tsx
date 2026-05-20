"use client";

import { useState } from "react";
import { Badge } from "@/components/primitives/badge";
import type { CiEvent } from "@coding-agents/db/schema";

interface Props {
  events: CiEvent[];
}

const statusVariant: Record<string, "success" | "failure" | "pending" | "neutral"> = {
  success: "success",
  failure: "failure",
  pending: "pending",
  running: "pending",
  error: "failure",
};

export function CiEventsPanel({ events }: Props) {
  const [open, setOpen] = useState(false);

  if (!events.length) return null;

  const latest = events[0];
  const variant = statusVariant[latest.status as string] ?? "neutral";

  return (
    <div className="overflow-hidden border border-stroke-subtle bg-surface-1/50">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 transition-colors duration-(--of-duration-instant) hover:bg-surface-2/50"
        onClick={() => setOpen((prev) => !prev)}
      >
        <svg
          className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <Badge variant={variant} dot>
          {latest.status}
        </Badge>
        <span className="text-sm font-medium text-text-primary">
          Actions — {events.length} run{events.length !== 1 ? "s" : ""}
        </span>
      </button>

      {open && (
        <div className="divide-y divide-stroke-subtle border-t border-stroke-subtle">
          {events.map((ev) => {
            const evVariant = statusVariant[ev.status as string] ?? "neutral";
            return (
              <div key={ev.id} className="space-y-1 px-4 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant={evVariant} dot>
                    {ev.status}
                  </Badge>
                  <span className="text-sm font-medium text-text-primary">
                    {ev.workflowName ?? "CI Action"}
                  </span>
                  {ev.runId && (
                    <span className="ml-auto font-mono text-xs text-text-tertiary">
                      #{ev.runId}
                    </span>
                  )}
                </div>
                {ev.logsUrl && (
                  <a
                    href={ev.logsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-6 inline-block text-xs text-accent-text underline underline-offset-2 transition-colors duration-(--of-duration-instant) hover:text-accent"
                  >
                    View logs
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

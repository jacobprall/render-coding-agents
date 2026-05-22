"use client";

import { useMemo, useState } from "react";
import { ChevronDown, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGitStatus, type GitChange } from "@/hooks/use-git-status";

type SortKey = "path" | "status";

function statusIcon(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("add") || s === "a" || s === "??") return "+";
  if (s.includes("delete") || s === "d") return "-";
  return "~";
}

function statusColor(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("add") || s === "a" || s === "??") return "text-accent-text";
  if (s.includes("delete") || s === "d") return "text-danger";
  return "text-warning";
}

interface GitPanelProps {
  sessionId: string;
  enabled?: boolean;
}

export function GitPanel({ sessionId, enabled = true }: GitPanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>("path");
  const { status, isLoading, error } = useGitStatus({
    sessionId,
    enabled,
  });

  const sortedChanges = useMemo(() => {
    const changes = status?.changes ?? [];
    return [...changes].sort((a, b) => {
      if (sortKey === "status") {
        return a.status.localeCompare(b.status) || a.path.localeCompare(b.path);
      }
      return a.path.localeCompare(b.path);
    });
  }, [status?.changes, sortKey]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-danger">
        Failed to load git status
      </div>
    );
  }

  if (isLoading && !status) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-xs text-text-tertiary">
        Loading git status…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-stroke-subtle px-3 py-2.5">
        <GitBranch className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-stroke-subtle bg-surface-2 px-2 py-0.5 text-[11px] font-mono text-text-primary">
          {status?.branch ?? "main"}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
          Local
        </span>
      </div>

      <div className="flex shrink-0 items-center justify-between border-b border-stroke-subtle/50 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
          Changes
        </span>
        <div className="relative">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="appearance-none rounded border border-stroke-subtle bg-surface-1 py-0.5 pl-2 pr-6 text-[10px] text-text-secondary"
          >
            <option value="path">Sort by path</option>
            <option value="status">Sort by status</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-1 top-1/2 size-3 -translate-y-1/2 text-text-tertiary" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {sortedChanges.length === 0 ? (
          <p className="px-4 py-12 text-center text-xs text-text-tertiary">
            No uncommitted changes on your local branch
          </p>
        ) : (
          <ul className="divide-y divide-stroke-subtle/40">
            {sortedChanges.map((change: GitChange) => (
              <li
                key={change.path}
                className="flex items-start gap-2 px-3 py-2 text-xs"
              >
                <span
                  className={cn(
                    "mt-0.5 w-3 shrink-0 text-center font-mono font-bold",
                    statusColor(change.status),
                  )}
                >
                  {statusIcon(change.status)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-text-secondary">{change.path}</p>
                  <p className="mt-0.5 font-mono tabular-nums text-[10px]">
                    <span className="text-accent-text">+{change.linesAdded}</span>
                    <span className="mx-1 text-text-tertiary">/</span>
                    <span className="text-danger">-{change.linesRemoved}</span>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

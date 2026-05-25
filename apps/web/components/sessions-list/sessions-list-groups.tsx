"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSessionsListState } from "./sessions-list-context";
import { repoSlug } from "./sessions-list-utils";
import type { SessionGroup, SessionItem } from "./sessions-list-context";

interface SessionsListGroupsProps {
  className?: string;
  renderItem?: (session: SessionItem, index: number) => ReactNode;
  groupHeaderClassName?: string;
  skeleton?: ReactNode;
}

function SessionsListGroups({
  className,
  renderItem,
  groupHeaderClassName,
  skeleton,
}: SessionsListGroupsProps) {
  const { filteredGroups, isLoading, selectSession } = useSessionsListState();

  if (isLoading || !filteredGroups) {
    return (
      skeleton ?? (
        <div className="space-y-2 p-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-muted/40" />
          ))}
        </div>
      )
    );
  }

  if (filteredGroups.length === 0) return null;

  const defaultRenderItem = (session: SessionItem) => (
    <button
      key={session.id}
      type="button"
      onClick={() => selectSession(session.id)}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
    >
      {session.title || "Untitled"}
    </button>
  );

  let globalIndex = 0;

  return (
    <div className={cn("py-1", className)} role="list">
      {filteredGroups.map((group) => {
        const startIndex = globalIndex;
        globalIndex += group.sessions.length;

        return (
          <div key={group.repoPath ?? "scratch"} className="mb-2">
            <p
              className={cn(
                "px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground",
                groupHeaderClassName,
              )}
            >
              {group.label ?? repoSlug(group.repoPath)}
            </p>
            {group.sessions.map((session, i) =>
              (renderItem ?? defaultRenderItem)(session, startIndex + i),
            )}
          </div>
        );
      })}
    </div>
  );
}
SessionsListGroups.displayName = "SessionsList.Groups";

export { SessionsListGroups };

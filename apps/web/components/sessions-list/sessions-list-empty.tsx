"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useSessionsListState } from "./sessions-list-context";

interface SessionsListEmptyProps {
  className?: string;
  children?: ReactNode;
}

function SessionsListEmpty({ className, children }: SessionsListEmptyProps) {
  const { filteredGroups, isLoading, query, filter } = useSessionsListState();

  if (isLoading || !filteredGroups || filteredGroups.length > 0) return null;

  if (children) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div className={cn("px-3 py-8 text-center text-xs text-muted-foreground", className)}>
      {query
        ? "No matching sessions"
        : filter === "archived"
          ? "No archived sessions"
          : "No sessions yet"}
    </div>
  );
}
SessionsListEmpty.displayName = "SessionsList.Empty";

export { SessionsListEmpty };

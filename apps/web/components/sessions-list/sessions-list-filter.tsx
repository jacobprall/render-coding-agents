"use client";

import { Archive, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionsListState } from "./sessions-list-context";

interface SessionsListFilterProps {
  className?: string;
  variant?: "icon" | "icon-archive";
}

function SessionsListFilter({
  className,
  variant = "icon",
}: SessionsListFilterProps) {
  const { filter, setFilter } = useSessionsListState();
  const isArchived = filter === "archived";
  const Icon = variant === "icon-archive" ? Archive : Filter;

  return (
    <button
      type="button"
      title={isArchived ? "Show active sessions" : "Show archived sessions"}
      aria-pressed={isArchived}
      aria-label={isArchived ? "Show active sessions" : "Show archived sessions"}
      onClick={() => setFilter((f) => (f === "active" ? "archived" : "active"))}
      className={cn(
        "flex items-center justify-center transition-colors",
        isArchived
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
SessionsListFilter.displayName = "SessionsList.Filter";

export { SessionsListFilter };

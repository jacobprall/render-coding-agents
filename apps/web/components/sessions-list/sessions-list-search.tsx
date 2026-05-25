"use client";

import { forwardRef } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSessionsListState } from "./sessions-list-context";

interface SessionsListSearchProps {
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  onEscape?: () => void;
  onArrowDown?: () => void;
}

const SessionsListSearch = forwardRef<HTMLInputElement, SessionsListSearchProps>(
  function SessionsListSearch(
    {
      className,
      inputClassName,
      placeholder = "Search sessions…",
      onEscape,
      onArrowDown,
    },
    ref,
  ) {
    const { query, setQuery } = useSessionsListState();

    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
        <input
          ref={ref}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              if (query) {
                setQuery("");
              }
              onEscape?.();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              onArrowDown?.();
            }
          }}
          placeholder={placeholder}
          aria-label="Search sessions"
          className={cn(
            "w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none",
            inputClassName,
          )}
        />
      </div>
    );
  },
);
SessionsListSearch.displayName = "SessionsList.Search";

export { SessionsListSearch };

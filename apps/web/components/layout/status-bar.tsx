"use client";

import { Folder, GitBranch, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatusBarProps {
  repoPath?: string;
  branch?: string;
  isStreaming?: boolean;
  className?: string;
}

export function StatusBar({ repoPath, branch, isStreaming, className }: StatusBarProps) {
  return (
    <footer
      className={cn(
        "flex h-[var(--status-bar-height)] shrink-0 items-center justify-between border-t border-border bg-[hsl(220,5%,5%)] px-3 text-xs text-muted-foreground",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Folder className="h-3 w-3 shrink-0" aria-hidden />
        <span className="truncate">Local</span>
        {branch ? (
          <>
            <GitBranch className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{branch}</span>
          </>
        ) : null}
        {repoPath ? (
          <span className="truncate text-text-tertiary" title={repoPath}>
            {repoPath}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5">
        {isStreaming ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            <span>Streaming</span>
          </>
        ) : null}
      </div>
    </footer>
  );
}

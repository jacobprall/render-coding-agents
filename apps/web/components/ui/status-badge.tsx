import * as React from "react";
import { cn } from "@/lib/utils";

const STATUS_MAP = {
  running: { label: "Running", color: "bg-blue-500/10 text-blue-500 border-blue-500/25", dot: "bg-blue-500 animate-pulse" },
  completed: { label: "Completed", color: "bg-green-500/10 text-green-500 border-green-500/25", dot: "bg-green-500" },
  failed: { label: "Failed", color: "bg-destructive/10 text-destructive border-destructive/25", dot: "bg-destructive" },
  archived: { label: "Archived", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" },
  queued: { label: "Queued", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/25", dot: "bg-yellow-500" },
  error: { label: "Error", color: "bg-destructive/10 text-destructive border-destructive/25", dot: "bg-destructive" },
  aborted: { label: "Aborted", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" },
  open: { label: "Open", color: "bg-green-500/10 text-green-500 border-green-500/25", dot: "bg-green-500" },
  merged: { label: "Merged", color: "bg-purple-500/10 text-purple-500 border-purple-500/25", dot: "bg-purple-500" },
  closed: { label: "Closed", color: "bg-destructive/10 text-destructive border-destructive/25", dot: "bg-destructive" },
  success: { label: "Success", color: "bg-green-500/10 text-green-500 border-green-500/25", dot: "bg-green-500" },
  failure: { label: "Failure", color: "bg-destructive/10 text-destructive border-destructive/25", dot: "bg-destructive" },
  pending: { label: "Pending", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/25", dot: "bg-yellow-500 animate-pulse" },
  active: { label: "Active", color: "bg-green-500/10 text-green-500 border-green-500/25", dot: "bg-green-500" },
  paused: { label: "Paused", color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/25", dot: "bg-yellow-500" },
  public: { label: "Public", color: "bg-blue-500/10 text-blue-500 border-blue-500/25", dot: "bg-blue-500" },
  private: { label: "Private", color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" },
} as const;

export type StatusKey = keyof typeof STATUS_MAP;

export interface StatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: StatusKey | (string & {});
  label?: string;
  dot?: boolean;
}

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(
  ({ status, label, dot = true, className, ...props }, ref) => {
    const resolved = STATUS_MAP[status as StatusKey] ?? {
      label: status,
      color: "bg-muted text-muted-foreground border-border",
      dot: "bg-muted-foreground",
    };

    return (
      <span
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
          resolved.color,
          className,
        )}
        {...props}
      >
        {dot && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", resolved.dot)} />}
        {label ?? resolved.label}
      </span>
    );
  },
);

StatusBadge.displayName = "StatusBadge";

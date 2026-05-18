import React from "react";

interface CostBadgeProps {
  costUsd?: string | number | null;
  tokens?: { prompt?: number; completion?: number };
  className?: string;
}

/**
 * Displays agent run cost and/or token usage as a compact badge.
 */
export function CostBadge({ costUsd, tokens, className }: CostBadgeProps) {
  const cost = typeof costUsd === "string" ? parseFloat(costUsd) : (costUsd ?? undefined);
  const hasTokens = tokens && (tokens.prompt || tokens.completion);

  if (cost == null && !hasTokens) return null;

  const parts: string[] = [];
  if (cost != null && cost > 0) {
    parts.push(`$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`);
  }
  if (hasTokens) {
    const total = (tokens.prompt ?? 0) + (tokens.completion ?? 0);
    if (total > 0) {
      parts.push(`${(total / 1000).toFixed(1)}k tok`);
    }
  }

  if (parts.length === 0) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/50 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground ${className ?? ""}`}
    >
      <svg
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      {parts.join(" · ")}
    </span>
  );
}

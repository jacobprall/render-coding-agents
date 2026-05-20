"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { agentSessionPullHref } from "@/lib/session-pr-href";

interface PrSummaryProps {
  sessionId: string;
  repoPath: string;
  prNumber: number;
  prStatus: string | null;
  branch: string | null;
  upstreamPrUrl?: string | null;
}

const statusConfig: Record<string, { color: string; label: string; dotColor: string }> = {
  open: { color: "text-accent-text", label: "Open", dotColor: "bg-accent" },
  merged: { color: "text-purple-400", label: "Merged", dotColor: "bg-purple-400" },
  closed: { color: "text-danger", label: "Closed", dotColor: "bg-red-400" },
};

function PrHrefLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  const external = href.startsWith("http://") || href.startsWith("https://");
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

export function PrSummaryPanel({
  sessionId,
  repoPath,
  prNumber,
  prStatus,
  branch,
  upstreamPrUrl,
}: PrSummaryProps) {
  const [isPending, startTransition] = useTransition();
  const [reviewRequested, setReviewRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = statusConfig[prStatus ?? "open"] ?? statusConfig.open;
  const prUrl = agentSessionPullHref({
    repoPath,
    prNumber,
    upstreamPrUrl,
  });

  async function handleRequestReview() {
    setError(null);
    startTransition(async () => {
      try {
        const { ok, data } = await apiFetch<{ error?: string }>(
          `/api/sessions/${sessionId}/review`,
          { method: "POST" },
        );
        if (!ok) {
          setError(typeof data.error === "string" ? data.error : "Failed to request review");
          return;
        }
        setReviewRequested(true);
      } catch {
        setError("Network error");
      }
    });
  }

  return (
    <div className="border border-stroke-subtle bg-surface-1/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <svg className="h-4 w-4 shrink-0 text-text-tertiary" fill="currentColor" viewBox="0 0 16 16">
            <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354Z" />
          </svg>
          <PrHrefLink
            href={prUrl}
            className="truncate text-sm font-medium text-text-primary hover:text-accent-text transition-colors duration-(--of-duration-instant)"
          >
            PR #{prNumber}
          </PrHrefLink>
          <span className="flex items-center gap-1.5 text-xs">
            <span className={`h-1.5 w-1.5 rounded-full ${status.dotColor}`} />
            <span className={status.color}>{status.label}</span>
          </span>
        </div>

        {prStatus === "open" && (
          <div className="flex items-center gap-2 shrink-0">
            <PrHrefLink
              href={prUrl}
              className="px-2 py-1 text-xs font-medium text-text-tertiary transition-colors duration-(--of-duration-instant) hover:bg-surface-2 hover:text-text-primary"
            >
              View Diff
            </PrHrefLink>
            {reviewRequested ? (
              <span className="text-xs text-accent-text">Review started</span>
            ) : (
              <button
                onClick={handleRequestReview}
                disabled={isPending}
                className="bg-surface-2 px-2.5 py-1 text-xs font-medium text-text-primary transition-colors duration-(--of-duration-instant) hover:bg-surface-3 disabled:opacity-50"
              >
                {isPending ? "Starting..." : "Agent Review"}
              </button>
            )}
          </div>
        )}
      </div>

      {branch && (
        <div className="mt-1.5 flex items-center gap-1 text-[11px] text-text-tertiary">
          <span className="font-mono">{branch}</span>
          <svg className="h-3 w-3 text-text-tertiary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>
          <span className="font-mono">main</span>
        </div>
      )}

      {error && (
        <div className="mt-2 border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs text-danger">
          {error}
        </div>
      )}
    </div>
  );
}

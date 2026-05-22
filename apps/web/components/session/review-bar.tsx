"use client";

import { useState } from "react";
import { ChevronDown, GitCommitHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnifiedDiffViewer } from "@/components/diff-viewer";
import { Disclosure } from "@/components/primitives/disclosure";

export interface ReviewFileChange {
  path: string;
  linesAdded: number;
  linesRemoved: number;
  unifiedDiffPreview?: string;
}

interface ReviewBarProps {
  fileChanges: ReviewFileChange[];
  sessionId: string;
  onCommit: () => void;
  onReviewClick: () => void;
  isCommitting?: boolean;
  commitMessage?: string;
}

export function ReviewBar({
  fileChanges,
  sessionId,
  onCommit,
  onReviewClick,
  isCommitting = false,
  commitMessage,
}: ReviewBarProps) {
  void sessionId;
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const totalAdded = fileChanges.reduce((s, f) => s + f.linesAdded, 0);
  const totalRemoved = fileChanges.reduce((s, f) => s + f.linesRemoved, 0);

  const combinedDiff = fileChanges
    .filter((f) => f.unifiedDiffPreview)
    .map((f) => f.unifiedDiffPreview)
    .join("\n");

  function handleReviewClick() {
    setExpanded((v) => !v);
    onReviewClick();
  }

  return (
    <div className="shrink-0 border-t border-stroke-subtle bg-surface-1/80">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-(--of-space-md) py-2">
        <button
          type="button"
          onClick={handleReviewClick}
          className={cn(
            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
            expanded
              ? "border-accent/30 bg-accent/10 text-text-primary"
              : "border-stroke-subtle bg-surface-2 text-text-secondary hover:text-text-primary",
          )}
        >
          Review
          <span className="font-mono tabular-nums">
            <span className="text-accent-text">+{totalAdded}</span>
            <span className="mx-0.5 text-text-tertiary"> </span>
            <span className="text-danger">-{totalRemoved}</span>
          </span>
        </button>

        <div className="relative flex items-center">
          <button
            type="button"
            onClick={onCommit}
            disabled={isCommitting}
            className="inline-flex items-center gap-1.5 rounded-l-md border border-stroke-subtle bg-surface-2 px-3 py-1 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-3 disabled:opacity-50"
          >
            <GitCommitHorizontal className="size-3.5" />
            {isCommitting ? "Committing…" : "Create Branch & Commit"}
          </button>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex items-center rounded-r-md border border-l-0 border-stroke-subtle bg-surface-2 px-1.5 py-1 text-text-tertiary transition-colors hover:bg-surface-3 hover:text-text-primary"
            aria-label="Commit options"
          >
            <ChevronDown className="size-3.5" />
          </button>
          {menuOpen ? (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
                aria-hidden
              />
              <div className="absolute right-0 top-full z-20 mt-1 min-w-[180px] rounded-md border border-stroke-subtle bg-surface-1 py-1 shadow-lg">
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-[11px] text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                  onClick={() => {
                    setMenuOpen(false);
                    onCommit();
                  }}
                >
                  Commit with default message
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>

      {commitMessage ? (
        <p className="mx-auto max-w-4xl px-(--of-space-md) pb-2 text-center text-[11px] text-accent-text">
          {commitMessage}
        </p>
      ) : null}

      {expanded ? (
        <div className="mx-auto max-w-4xl border-t border-stroke-subtle/50 px-(--of-space-md) py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium text-text-tertiary">
              {fileChanges.length} file{fileChanges.length !== 1 ? "s" : ""} changed
            </span>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[11px] text-accent-text transition-colors hover:text-text-primary"
            >
              Collapse
            </button>
          </div>
          {combinedDiff ? (
            <UnifiedDiffViewer diff={combinedDiff} />
          ) : (
            <div className="space-y-2">
              {fileChanges.map((file) =>
                file.unifiedDiffPreview ? (
                  <Disclosure key={file.path} title={file.path} defaultOpen={false}>
                    <UnifiedDiffViewer diff={file.unifiedDiffPreview} maxFiles={1} />
                  </Disclosure>
                ) : (
                  <Disclosure key={file.path} title={file.path} defaultOpen={false}>
                    <p className="text-xs text-text-tertiary">
                      +{file.linesAdded} / -{file.linesRemoved} (no diff preview)
                    </p>
                  </Disclosure>
                ),
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

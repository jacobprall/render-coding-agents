"use client";

import { FileTree } from "@/components/session/file-tree";
import { FilePreview } from "@/components/session/file-preview";
import { cn } from "@/lib/utils";

interface FileExplorerProps {
  sessionId: string;
  selectedPath: string | null;
  onFileSelect: (path: string) => void;
  onDeselect?: () => void;
  /** Narrow layout: full-width preview with back button when a file is open */
  compact?: boolean;
  treeWidth?: string;
  className?: string;
}

export function FileExplorer({
  sessionId,
  selectedPath,
  onFileSelect,
  onDeselect,
  compact = false,
  treeWidth = "w-56",
  className,
}: FileExplorerProps) {
  if (compact && selectedPath) {
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        <FilePreview
          sessionId={sessionId}
          filePath={selectedPath}
          onBack={onDeselect}
        />
      </div>
    );
  }

  return (
    <div className={cn("flex h-full min-h-0", className)}>
      <div
        className={cn(
          "shrink-0 overflow-hidden border-r border-stroke-subtle",
          treeWidth,
        )}
      >
        <FileTree
          sessionId={sessionId}
          selectedPath={selectedPath ?? undefined}
          onFileSelect={onFileSelect}
          onDeselect={onDeselect}
          expandToPath={selectedPath}
        />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        {selectedPath ? (
          <FilePreview sessionId={sessionId} filePath={selectedPath} />
        ) : (
          <ExplorerEmptyState />
        )}
      </div>
    </div>
  );
}

function ExplorerEmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-xs text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2/50">
          <svg
            className="h-5 w-5 text-text-tertiary"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
            />
          </svg>
        </div>
        <p className="text-sm text-text-secondary">Select a file to preview</p>
        <p className="mt-1 text-xs text-text-tertiary">
          Browse the directory tree on the left to open file contents.
        </p>
      </div>
    </div>
  );
}

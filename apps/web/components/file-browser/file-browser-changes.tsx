"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight, FileEdit } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { SingleFileDiffViewer } from "@/components/diff-viewer";
import { useFileBrowserContext } from "./file-browser-context";
import type { LiveFileChange } from "../session/use-agent-chat";

function FileBrowserChanges({ className }: { className?: string }) {
  const {
    subView,
    fileChanges,
    selectedDiffFile,
    setSelectedDiffFile,
    totalAdded,
    totalRemoved,
  } = useFileBrowserContext();

  const isMobile = useIsMobile();

  const selectedMeta = useMemo(
    () => (selectedDiffFile ? fileChanges.find((x) => x.path === selectedDiffFile) : undefined),
    [fileChanges, selectedDiffFile],
  );

  if (subView !== "changes") return null;

  if (fileChanges.length === 0) {
    return (
      <div className={cn("flex h-full items-center justify-center", className)}>
        <div className="text-center px-4">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2/50">
            <svg className="h-5 w-5 text-text-tertiary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
          </div>
          <p className="text-sm text-text-tertiary">No files changed yet</p>
          <p className="mt-1 text-xs text-text-tertiary">
            File changes will appear here as the agent works.
          </p>
        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <MobileChanges
        fileChanges={fileChanges}
        selectedFile={selectedDiffFile}
        onSelectFile={setSelectedDiffFile}
        totalAdded={totalAdded}
        totalRemoved={totalRemoved}
        selectedMeta={selectedMeta}
        className={className}
      />
    );
  }

  return (
    <div className={cn("flex h-full", className)}>
      <div className="w-64 shrink-0 overflow-y-auto border-r border-stroke-subtle">
        <div className="flex items-center justify-between border-b border-stroke-subtle/50 px-3 py-2.5">
          <span className="text-[11px] font-medium text-text-tertiary">
            {fileChanges.length} file{fileChanges.length !== 1 ? "s" : ""}
          </span>
          <span className="text-[11px] font-mono tabular-nums">
            <span className="text-accent-text/70">+{totalAdded}</span>
            <span className="mx-0.5 text-text-tertiary">/</span>
            <span className="text-danger/70">-{totalRemoved}</span>
          </span>
        </div>
        <div className="py-1">
          {fileChanges.map((file) => {
            const filename = file.path.split("/").pop() ?? file.path;
            const dir = file.path.includes("/")
              ? file.path.slice(0, file.path.lastIndexOf("/"))
              : "";
            const isSelected = selectedDiffFile === file.path;

            return (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedDiffFile(isSelected ? null : file.path)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors duration-(--of-duration-instant) ${
                  isSelected
                    ? "bg-surface-2/80 text-text-primary"
                    : "text-text-tertiary hover:bg-surface-2/40 hover:text-text-secondary"
                }`}
              >
                <svg className="h-3.5 w-3.5 shrink-0 text-text-tertiary" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{filename}</span>
                  {dir ? <span className="block truncate font-mono text-[10px] text-text-tertiary">{dir}</span> : null}
                </div>
                <span className="shrink-0 font-mono text-[10px] tabular-nums">
                  <span className="text-accent-text/60">+{file.additions}</span>{" "}
                  <span className="text-danger/60">-{file.deletions}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedDiffFile ? (
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="font-mono text-xs text-text-tertiary">{selectedDiffFile}</span>
              {selectedMeta ? (
                <span className="font-mono text-[11px] tabular-nums">
                  <span className="text-accent-text/70">+{selectedMeta.additions}</span>
                  <span className="mx-0.5 text-text-tertiary">/</span>
                  <span className="text-danger/70">-{selectedMeta.deletions}</span>
                </span>
              ) : null}
            </div>
            {selectedMeta?.unifiedDiffPreview ? (
              <SingleFileDiffViewer diff={selectedMeta.unifiedDiffPreview} />
            ) : (
              <div className="border border-stroke-subtle bg-surface-1/50 p-6 text-center">
                <p className="text-xs text-text-tertiary">
                  No diff preview available. File was modified with{" "}
                  {selectedMeta
                    ? `${selectedMeta.additions} additions and ${selectedMeta.deletions} deletions`
                    : "changes"}.
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-text-tertiary">Select a file to view changes</p>
          </div>
        )}
      </div>
    </div>
  );
}
FileBrowserChanges.displayName = "FileBrowser.Changes";

function MobileChanges({
  fileChanges,
  selectedFile,
  onSelectFile,
  totalAdded,
  totalRemoved,
  selectedMeta,
  className,
}: {
  fileChanges: LiveFileChange[];
  selectedFile: string | null;
  onSelectFile: (path: string | null) => void;
  totalAdded: number;
  totalRemoved: number;
  selectedMeta: LiveFileChange | undefined;
  className?: string;
}) {
  if (selectedFile && selectedMeta) {
    const filename = selectedFile.split("/").pop() ?? selectedFile;
    return (
      <div className={cn("flex h-full flex-col overflow-hidden", className)}>
        <div className="flex shrink-0 items-center gap-2 border-b border-stroke-subtle px-3 py-2">
          <button
            type="button"
            onClick={() => onSelectFile(null)}
            className="flex h-9 w-9 items-center justify-center text-text-tertiary active:bg-surface-1"
            aria-label="Back to file list"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-xs text-text-secondary">{filename}</p>
            <span className="font-mono text-[10px] tabular-nums">
              <span className="text-accent-text/70">+{selectedMeta.additions}</span>
              <span className="mx-0.5 text-text-tertiary">/</span>
              <span className="text-danger/70">-{selectedMeta.deletions}</span>
            </span>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3" style={{ WebkitOverflowScrolling: "touch" }}>
          {selectedMeta.unifiedDiffPreview ? (
            <SingleFileDiffViewer diff={selectedMeta.unifiedDiffPreview} />
          ) : (
            <div className="border border-stroke-subtle bg-surface-1/50 p-6 text-center">
              <p className="text-xs text-text-tertiary">
                No diff preview available. File was modified with{" "}
                {`${selectedMeta.additions} additions and ${selectedMeta.deletions} deletions`}.
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col overflow-hidden", className)}>
      <div className="flex shrink-0 items-center justify-between border-b border-stroke-subtle/50 px-3 py-2">
        <span className="text-[11px] font-medium text-text-tertiary">
          {fileChanges.length} file{fileChanges.length !== 1 ? "s" : ""} changed
        </span>
        <span className="font-mono text-[11px] tabular-nums">
          <span className="text-accent-text/70">+{totalAdded}</span>
          <span className="mx-0.5 text-text-tertiary">/</span>
          <span className="text-danger/70">-{totalRemoved}</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
        <div className="divide-y divide-stroke-subtle">
          {fileChanges.map((file) => {
            const filename = file.path.split("/").pop() ?? file.path;
            const dir = file.path.includes("/")
              ? file.path.slice(0, file.path.lastIndexOf("/"))
              : "";

            return (
              <button
                key={file.path}
                type="button"
                onClick={() => onSelectFile(file.path)}
                className="flex min-h-[48px] w-full items-center gap-3 px-3 py-2.5 text-left transition-colors active:bg-surface-1"
              >
                <FileEdit className="size-4 shrink-0 text-text-tertiary" />
                <div className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm text-text-secondary">{filename}</span>
                  {dir ? <span className="block truncate font-mono text-[11px] text-text-tertiary">{dir}</span> : null}
                </div>
                <span className="shrink-0 font-mono text-[11px] tabular-nums">
                  <span className="text-accent-text/60">+{file.additions}</span>{" "}
                  <span className="text-danger/60">-{file.deletions}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-text-tertiary" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { FileBrowserChanges };

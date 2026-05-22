"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderTree, GitBranch, PanelLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileTree } from "@/components/session/file-tree";
import { FilePreview } from "@/components/session/file-preview";
import { GitPanel } from "@/components/session/git-panel";
export type { RightPanelMode } from "./right-panel-context";
import type { RightPanelMode } from "./right-panel-context";

interface RightPanelProps {
  mode: RightPanelMode;
  sessionId: string;
  onModeChange: (mode: RightPanelMode) => void;
  width: number;
  selectedPath?: string | null;
  onClearSelection?: () => void;
  mobile?: boolean;
}

function getModeAnnouncement(mode: RightPanelMode, width: number): string {
  if (mode === "closed" || width === 0) return "Panel closed";
  if (mode === "git") return "Git mode";
  return "Files mode";
}

export function RightPanel({
  mode,
  sessionId,
  onModeChange,
  width,
  selectedPath,
  onClearSelection,
  mobile = false,
}: RightPanelProps) {
  const [localSelectedPath, setLocalSelectedPath] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState(() =>
    getModeAnnouncement(mode, width),
  );

  const activePath = selectedPath ?? localSelectedPath;

  useEffect(() => {
    setAnnouncement(getModeAnnouncement(mode, width));
  }, [mode, width]);

  const handleFileSelect = useCallback((path: string) => {
    setLocalSelectedPath(path);
  }, []);

  const handleClose = useCallback(() => {
    onModeChange("closed");
    setLocalSelectedPath(null);
    onClearSelection?.();
  }, [onModeChange, onClearSelection]);

  const handleBackToTree = useCallback(() => {
    setLocalSelectedPath(null);
    onClearSelection?.();
  }, [onClearSelection]);

  const handleDeselect = useCallback(() => {
    setLocalSelectedPath(null);
    onClearSelection?.();
  }, [onClearSelection]);

  const isOpen = mode !== "closed" && width !== 0;
  const showSplit = mode === "files" && activePath;

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      {isOpen ? (
        <aside
          aria-label="File explorer panel"
          className={cn(
            "flex min-w-0 flex-col overflow-hidden bg-card transition-all duration-200",
            mobile ? "h-full w-full" : "h-full border-l border-border",
          )}
          style={mobile ? undefined : { width }}
        >
          <div className="flex shrink-0 items-center justify-between border-b border-stroke-subtle px-2 py-1.5">
            <div className="flex items-center gap-0.5">
              <PanelTabButton
                active={mode === "files"}
                onClick={() => onModeChange(mode === "files" ? "closed" : "files")}
                title="Files"
                ariaLabel="Switch to files mode"
              >
                <FolderTree className="size-3.5" />
              </PanelTabButton>
              <PanelTabButton
                active={mode === "git"}
                onClick={() => onModeChange(mode === "git" ? "closed" : "git")}
                title="Git"
                ariaLabel="Switch to git mode"
              >
                <GitBranch className="size-3.5" />
              </PanelTabButton>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary"
              title="Close panel"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden transition-all duration-200">
            {mode === "git" ? (
              <GitPanel sessionId={sessionId} enabled={mode === "git"} />
            ) : mode === "preview" && activePath ? (
              <FilePreview
                sessionId={sessionId}
                filePath={activePath}
                onBack={() => {
                  setLocalSelectedPath(null);
                  onClearSelection?.();
                  onModeChange("files");
                }}
              />
            ) : showSplit ? (
              <div className="flex h-full min-h-0">
                <div className="flex w-10 shrink-0 flex-col items-center border-r border-stroke-subtle bg-surface-1 py-2 transition-all duration-200">
                  <button
                    type="button"
                    onClick={handleBackToTree}
                    className="rounded p-1.5 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary"
                    title="Back to full tree"
                  >
                    <PanelLeft className="size-4" />
                  </button>
                  <div className="mt-2 flex flex-1 flex-col items-center pt-1">
                    <FolderTree className="size-3.5 text-text-tertiary/40" aria-hidden />
                  </div>
                </div>
                <div className="min-w-0 flex-1 overflow-hidden transition-all duration-200">
                  <FilePreview
                    sessionId={sessionId}
                    filePath={activePath}
                    onBack={handleBackToTree}
                  />
                </div>
              </div>
            ) : (
              <div className="h-full overflow-y-auto transition-all duration-200">
                <FileTree
                  sessionId={sessionId}
                  selectedPath={activePath ?? undefined}
                  onFileSelect={handleFileSelect}
                  onDeselect={handleDeselect}
                />
              </div>
            )}
          </div>
        </aside>
      ) : null}
    </>
  );
}

function PanelTabButton({
  active,
  onClick,
  title,
  ariaLabel,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "rounded p-1.5 transition-colors",
        active
          ? "bg-surface-2 text-text-primary"
          : "text-text-tertiary hover:bg-surface-2/50 hover:text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { PanelLeft, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileTree } from "@/components/session/file-tree";
import { FilePreview } from "@/components/session/file-preview";
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
  const showSplit = (mode === "files" || mode === "preview") && activePath;

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
          <div className="flex shrink-0 items-center justify-end border-b border-stroke-subtle px-2 py-1.5">
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
            {mode === "preview" && activePath ? (
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

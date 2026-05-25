"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FileExplorer } from "@/components/session/file-explorer";
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
    if (selectedPath) {
      setLocalSelectedPath(selectedPath);
    }
  }, [selectedPath]);

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

  const handleDeselect = useCallback(() => {
    setLocalSelectedPath(null);
    onClearSelection?.();
  }, [onClearSelection]);

  const isOpen = mode !== "closed" && width !== 0;
  const useCompactExplorer = mobile || width < 480;

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
          <div
            className={cn(
              "flex shrink-0 items-center justify-between border-b border-stroke-subtle",
              mobile ? "px-2 py-1" : "px-2 py-1.5",
            )}
          >
            <span className="text-[11px] font-medium text-text-tertiary">Explorer</span>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close panel"
              className={cn(
                "flex items-center justify-center text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary",
                mobile ? "h-11 w-11" : "h-7 w-7 rounded p-1",
              )}
            >
              <X className={mobile ? "size-5" : "size-3.5"} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <FileExplorer
              sessionId={sessionId}
              selectedPath={activePath}
              onFileSelect={handleFileSelect}
              onDeselect={handleDeselect}
              compact={useCompactExplorer}
              treeWidth={width < 560 ? "w-44" : "w-52"}
            />
          </div>
        </aside>
      ) : null}
    </>
  );
}

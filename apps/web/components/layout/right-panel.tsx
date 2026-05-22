"use client";

import { useCallback, useState } from "react";
import { FolderTree, GitBranch, X } from "lucide-react";
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
}

export function RightPanel({
  mode,
  sessionId,
  onModeChange,
  width,
  selectedPath,
  onClearSelection,
}: RightPanelProps) {
  const [localSelectedPath, setLocalSelectedPath] = useState<string | null>(null);

  const activePath = selectedPath ?? localSelectedPath;

  const handleFileSelect = useCallback((path: string) => {
    setLocalSelectedPath(path);
  }, []);

  const handleClose = useCallback(() => {
    onModeChange("closed");
    setLocalSelectedPath(null);
    onClearSelection?.();
  }, [onModeChange, onClearSelection]);

  if (mode === "closed" || width === 0) {
    return null;
  }

  const showSplit = mode === "files" && activePath;

  return (
    <aside
      className="flex h-full min-w-0 flex-col overflow-hidden border-l border-border bg-card"
      style={{ width }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-stroke-subtle px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          <PanelTabButton
            active={mode === "files"}
            onClick={() => onModeChange(mode === "files" ? "closed" : "files")}
            title="Files"
          >
            <FolderTree className="size-3.5" />
          </PanelTabButton>
          <PanelTabButton
            active={mode === "git"}
            onClick={() => onModeChange(mode === "git" ? "closed" : "git")}
            title="Git"
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

      <div className="min-h-0 flex-1 overflow-hidden">
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
            <div className="w-2/5 min-w-[120px] shrink-0 overflow-y-auto border-r border-stroke-subtle">
              <FileTree
                sessionId={sessionId}
                selectedPath={activePath}
                onFileSelect={handleFileSelect}
              />
            </div>
            <div className="min-w-0 flex-1 overflow-hidden">
              <FilePreview
                sessionId={sessionId}
                filePath={activePath}
                onBack={() => {
                  setLocalSelectedPath(null);
                  onClearSelection?.();
                }}
              />
            </div>
          </div>
        ) : (
          <div className="h-full overflow-y-auto">
            <FileTree
              sessionId={sessionId}
              selectedPath={activePath ?? undefined}
              onFileSelect={handleFileSelect}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

function PanelTabButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
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

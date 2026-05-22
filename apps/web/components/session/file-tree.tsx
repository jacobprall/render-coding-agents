"use client";

import { useCallback } from "react";
import { cn } from "@/lib/utils";
import { getFileIconChar, getFileIconColor } from "@/lib/file-icons";
import {
  useFileTree,
  type FileTreeEntry,
} from "@/hooks/use-file-tree";

const INDENT_PX = 16;

interface FileTreeProps {
  sessionId: string;
  onFileSelect: (path: string) => void;
  selectedPath?: string;
}

function TreeNode({
  entry,
  depth,
  sessionId,
  expandedPaths,
  selectedPath,
  onToggle,
  onFileSelect,
  getChildren,
}: {
  entry: FileTreeEntry;
  depth: number;
  sessionId: string;
  expandedPaths: Set<string>;
  selectedPath?: string;
  onToggle: (path: string) => void;
  onFileSelect: (path: string) => void;
  getChildren: (path: string) => FileTreeEntry[];
}) {
  const isDir = entry.type === "directory";
  const isExpanded = expandedPaths.has(entry.path);
  const isSelected = !isDir && selectedPath === entry.path;
  const paddingLeft = depth * INDENT_PX;

  const handleClick = useCallback(() => {
    if (isDir) {
      onToggle(entry.path);
    } else {
      onFileSelect(entry.path);
    }
  }, [isDir, entry.path, onToggle, onFileSelect]);

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "flex w-full items-center gap-1 py-0.5 pr-2 text-left text-xs transition-colors",
          isSelected
            ? "bg-surface-2/80 text-text-primary"
            : "text-text-secondary hover:bg-surface-2/40 hover:text-text-primary",
        )}
        style={{ paddingLeft }}
      >
        {isDir ? (
          <span className="w-3 shrink-0 text-[10px] text-text-tertiary">
            {isExpanded ? "▼" : "▶"}
          </span>
        ) : (
          <span
            className={cn(
              "w-3 shrink-0 text-center text-[10px] font-mono",
              getFileIconColor(entry.name),
            )}
          >
            {getFileIconChar(entry.name)}
          </span>
        )}
        <span className="truncate font-mono">{entry.name}</span>
      </button>
      {isDir && isExpanded
        ? getChildren(entry.path).map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              sessionId={sessionId}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onFileSelect={onFileSelect}
              getChildren={getChildren}
            />
          ))
        : null}
    </>
  );
}

export function FileTree({ sessionId, onFileSelect, selectedPath }: FileTreeProps) {
  const { expandedPaths, toggle, getChildren, isLoading, error } = useFileTree(sessionId);

  if (error) {
    return (
      <div className="p-3 text-xs text-danger">
        Failed to load file tree
      </div>
    );
  }

  if (isLoading && getChildren("/").length === 0) {
    return (
      <div className="p-3 text-xs text-text-tertiary">
        Loading files…
      </div>
    );
  }

  const rootEntries = getChildren("/");

  if (rootEntries.length === 0) {
    return (
      <div className="p-3 text-xs text-text-tertiary">
        No files found
      </div>
    );
  }

  return (
    <div className="py-1">
      {rootEntries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          sessionId={sessionId}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          onToggle={toggle}
          onFileSelect={onFileSelect}
          getChildren={getChildren}
        />
      ))}
    </div>
  );
}

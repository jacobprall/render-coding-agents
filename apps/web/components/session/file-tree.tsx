"use client";

import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { getFileIconChar, getFileIconColor } from "@/lib/file-icons";
import {
  useFileTree,
  type FileTreeEntry,
} from "@/hooks/use-file-tree";

const INDENT_PX = 16;

interface VisibleItem {
  path: string;
  type: FileTreeEntry["type"];
}

interface FileTreeProps {
  sessionId: string;
  onFileSelect: (path: string) => void;
  selectedPath?: string;
  onDeselect?: () => void;
}

function collectVisibleItems(
  entries: FileTreeEntry[],
  getChildren: (path: string) => FileTreeEntry[],
  expandedPaths: Set<string>,
): VisibleItem[] {
  const result: VisibleItem[] = [];

  for (const entry of entries) {
    result.push({ path: entry.path, type: entry.type });
    if (entry.type === "directory" && expandedPaths.has(entry.path)) {
      result.push(
        ...collectVisibleItems(getChildren(entry.path), getChildren, expandedPaths),
      );
    }
  }

  return result;
}

function getParentPath(path: string): string | null {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash <= 0) return null;
  return path.slice(0, lastSlash) || "/";
}

function TreeNode({
  entry,
  depth,
  sessionId,
  expandedPaths,
  selectedPath,
  focusedPath,
  onToggle,
  onFileSelect,
  onFocusPath,
  getChildren,
  hasLoaded,
}: {
  entry: FileTreeEntry;
  depth: number;
  sessionId: string;
  expandedPaths: Set<string>;
  selectedPath?: string;
  focusedPath?: string | null;
  onToggle: (path: string) => void;
  onFileSelect: (path: string) => void;
  onFocusPath: (path: string) => void;
  getChildren: (path: string) => FileTreeEntry[];
  hasLoaded: (path: string) => boolean;
}) {
  const isDir = entry.type === "directory";
  const isExpanded = expandedPaths.has(entry.path);
  const isSelected = !isDir && selectedPath === entry.path;
  const isFocused = focusedPath === entry.path;
  const paddingLeft = depth * INDENT_PX;
  const children = isDir && isExpanded ? getChildren(entry.path) : [];
  const childPaddingLeft = (depth + 1) * INDENT_PX;

  const handleClick = useCallback(() => {
    onFocusPath(entry.path);
    if (isDir) {
      onToggle(entry.path);
    } else {
      onFileSelect(entry.path);
    }
  }, [isDir, entry.path, onToggle, onFileSelect, onFocusPath]);

  return (
    <>
      <button
        type="button"
        role="treeitem"
        aria-expanded={isDir ? isExpanded : undefined}
        onClick={handleClick}
        className={cn(
          "flex w-full items-center gap-1 py-0.5 pr-2 text-left text-xs transition-colors",
          isSelected
            ? "bg-surface-2/80 text-text-primary"
            : "text-text-secondary hover:bg-surface-2/40 hover:text-text-primary",
          isFocused && "ring-1 ring-accent/50",
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
      {isDir && isExpanded && children.length === 0 ? (
        <div
          className="py-0.5 pr-2 text-xs text-text-tertiary"
          style={{ paddingLeft: childPaddingLeft }}
        >
          {hasLoaded(entry.path) ? "(empty)" : "Loading..."}
        </div>
      ) : null}
      {isDir && isExpanded
        ? children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              sessionId={sessionId}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              focusedPath={focusedPath}
              onToggle={onToggle}
              onFileSelect={onFileSelect}
              onFocusPath={onFocusPath}
              getChildren={getChildren}
              hasLoaded={hasLoaded}
            />
          ))
        : null}
    </>
  );
}

export function FileTree({
  sessionId,
  onFileSelect,
  selectedPath,
  onDeselect,
}: FileTreeProps) {
  const { expandedPaths, toggle, getChildren, hasLoaded, isLoading, error, refresh } =
    useFileTree(sessionId);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  const rootEntries = getChildren("/");

  const visibleItems = useMemo(
    () => collectVisibleItems(rootEntries, getChildren, expandedPaths),
    [rootEntries, getChildren, expandedPaths],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (visibleItems.length === 0) return;

      const currentIndex = focusedPath
        ? visibleItems.findIndex((item) => item.path === focusedPath)
        : -1;
      const currentItem =
        currentIndex >= 0 ? visibleItems[currentIndex] : undefined;

      switch (event.key) {
        case "ArrowDown": {
          event.preventDefault();
          const nextIndex =
            currentIndex < 0 ? 0 : Math.min(currentIndex + 1, visibleItems.length - 1);
          setFocusedPath(visibleItems[nextIndex]!.path);
          break;
        }
        case "ArrowUp": {
          event.preventDefault();
          const prevIndex =
            currentIndex < 0
              ? visibleItems.length - 1
              : Math.max(currentIndex - 1, 0);
          setFocusedPath(visibleItems[prevIndex]!.path);
          break;
        }
        case "ArrowRight": {
          if (!currentItem || currentItem.type !== "directory") return;
          if (!expandedPaths.has(currentItem.path)) {
            event.preventDefault();
            toggle(currentItem.path);
          }
          break;
        }
        case "ArrowLeft": {
          if (!currentItem) return;
          event.preventDefault();
          if (currentItem.type === "directory" && expandedPaths.has(currentItem.path)) {
            toggle(currentItem.path);
          } else {
            const parent = getParentPath(currentItem.path);
            if (parent) setFocusedPath(parent);
          }
          break;
        }
        case "Enter": {
          if (!currentItem) return;
          event.preventDefault();
          if (currentItem.type === "directory") {
            toggle(currentItem.path);
          } else {
            onFileSelect(currentItem.path);
          }
          break;
        }
        case "Escape": {
          event.preventDefault();
          onDeselect?.();
          break;
        }
      }
    },
    [visibleItems, focusedPath, expandedPaths, toggle, onFileSelect, onDeselect],
  );

  if (error) {
    return (
      <div className="p-3 text-xs text-danger">
        <p>Failed to load file tree</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-1 text-accent-text hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (isLoading && rootEntries.length === 0) {
    return (
      <div className="p-3 text-xs text-text-tertiary">
        Loading files…
      </div>
    );
  }

  if (rootEntries.length === 0) {
    return (
      <div className="p-3 text-xs text-text-tertiary">
        No files found
      </div>
    );
  }

  return (
    <div
      role="tree"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="py-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
    >
      {rootEntries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          sessionId={sessionId}
          expandedPaths={expandedPaths}
          selectedPath={selectedPath}
          focusedPath={focusedPath}
          onToggle={toggle}
          onFileSelect={onFileSelect}
          onFocusPath={setFocusedPath}
          getChildren={getChildren}
          hasLoaded={hasLoaded}
        />
      ))}
    </div>
  );
}

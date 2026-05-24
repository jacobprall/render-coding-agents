"use client";

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { RefreshCw, Search } from "lucide-react";
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
  expandToPath?: string | null;
}

function gitStatusColor(status: string): string {
  switch (status) {
    case "A":
    case "??":
      return "text-accent-text";
    case "M":
      return "text-warning";
    case "D":
      return "text-danger";
    default:
      return "text-text-tertiary";
  }
}

function matchesFilter(name: string, path: string, filter: string): boolean {
  const q = filter.toLowerCase();
  return name.toLowerCase().includes(q) || path.toLowerCase().includes(q);
}

function directoryHasMatch(
  entry: FileTreeEntry,
  getChildren: (path: string) => FileTreeEntry[],
  filter: string,
): boolean {
  if (!filter) return true;
  if (entry.type === "file") {
    return matchesFilter(entry.name, entry.path, filter);
  }
  if (matchesFilter(entry.name, entry.path, filter)) return true;
  return getChildren(entry.path).some((child) =>
    directoryHasMatch(child, getChildren, filter),
  );
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
  filter,
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
  filter: string;
  onToggle: (path: string) => void;
  onFileSelect: (path: string) => void;
  onFocusPath: (path: string) => void;
  getChildren: (path: string) => FileTreeEntry[];
  hasLoaded: (path: string) => boolean;
}) {
  const isDir = entry.type === "directory";
  const isExpanded = expandedPaths.has(entry.path) || Boolean(filter);
  const isSelected = !isDir && selectedPath === entry.path;
  const isFocused = focusedPath === entry.path;
  const paddingLeft = depth * INDENT_PX;
  const children = isDir && isExpanded ? getChildren(entry.path) : [];
  const childPaddingLeft = (depth + 1) * INDENT_PX;
  const visibleChildren = filter
    ? children.filter((child) => directoryHasMatch(child, getChildren, filter))
    : children;

  if (filter && !directoryHasMatch(entry, getChildren, filter)) {
    return null;
  }

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
        {entry.gitStatus ? (
          <span
            className={cn(
              "ml-auto shrink-0 font-mono text-[9px]",
              gitStatusColor(entry.gitStatus),
            )}
            title={`Git: ${entry.gitStatus}`}
          >
            {entry.gitStatus}
          </span>
        ) : null}
      </button>
      {isDir && isExpanded && visibleChildren.length === 0 ? (
        <div
          className="py-0.5 pr-2 text-xs text-text-tertiary"
          style={{ paddingLeft: childPaddingLeft }}
        >
          {hasLoaded(entry.path) ? "(empty)" : "Loading..."}
        </div>
      ) : null}
      {isDir && isExpanded
        ? visibleChildren.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              sessionId={sessionId}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              focusedPath={focusedPath}
              filter={filter}
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
  expandToPath,
}: FileTreeProps) {
  const { expandedPaths, toggle, expandToPath: expandPath, getChildren, hasLoaded, isLoading, error, refresh } =
    useFileTree(sessionId);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (expandToPath) {
      expandPath(expandToPath);
    }
  }, [expandToPath, expandPath]);

  useEffect(() => {
    if (selectedPath) {
      expandPath(selectedPath);
    }
  }, [selectedPath, expandPath]);

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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-stroke-subtle/50 px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-text-tertiary" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files…"
            aria-label="Filter files"
            className="w-full rounded border border-stroke-subtle bg-surface-1 py-1 pl-7 pr-2 text-[11px] text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent/50"
          />
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          title="Refresh file tree"
          aria-label="Refresh file tree"
          className="shrink-0 rounded p-1 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>
      <div
        role="tree"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="min-h-0 flex-1 overflow-y-auto py-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/50"
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
            filter={filter}
            onToggle={toggle}
            onFileSelect={onFileSelect}
            onFocusPath={setFocusedPath}
            getChildren={getChildren}
            hasLoaded={hasLoaded}
          />
        ))}
      </div>
    </div>
  );
}

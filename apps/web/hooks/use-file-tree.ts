"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

export interface FileTreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  extension?: string;
  size?: number;
  gitStatus?: string;
}

export interface FileListResponse {
  path: string;
  entries: FileTreeEntry[];
}

type DirectoryCache = Record<string, FileListResponse>;

const fetcher = async (url: string): Promise<FileListResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  return res.json() as Promise<FileListResponse>;
};

async function fetchDirectories(
  sessionId: string,
  paths: string[],
): Promise<DirectoryCache> {
  const results = await Promise.all(
    paths.map(async (path) => {
      const url = `/api/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`;
      const data = await fetcher(url);
      return [path, data] as const;
    }),
  );
  return Object.fromEntries(results);
}

function parentDirectoryPath(filePath: string): string {
  const normalized = filePath.startsWith("/") ? filePath : `/${filePath}`;
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return "/";
  return normalized.slice(0, lastSlash) || "/";
}

const fileChangeListeners = new Set<(path: string) => void>();

/** Notify subscribers when a file is created, modified, or deleted via SSE. */
export function notifyFileTreeChange(filePath: string) {
  for (const listener of fileChangeListeners) {
    listener(filePath);
  }
}

interface UseFileTreeOptions {
  onFileChange?: (path: string) => void;
}

export function useFileTree(
  sessionId: string | null,
  options?: UseFileTreeOptions,
) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(["/"]));
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const pathsArray = useMemo(() => [...expandedPaths].sort(), [expandedPaths]);

  const swrKey =
    sessionId && pathsArray.length > 0
      ? (["file-tree", sessionId, pathsArray] as const)
      : null;

  const { data, error, isLoading, mutate } = useSWR<DirectoryCache>(
    swrKey,
    () => fetchDirectories(sessionId!, pathsArray),
    { revalidateOnFocus: false },
  );

  const toggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const select = useCallback((path: string) => {
    setSelectedPath(path);
  }, []);

  const getChildren = useCallback(
    (path: string): FileTreeEntry[] => data?.[path]?.entries ?? [],
    [data],
  );

  const hasLoaded = useCallback(
    (path: string): boolean => !!data?.[path],
    [data],
  );

  const invalidate = useCallback(
    async (path: string) => {
      if (!sessionId) return;
      await mutate(
        async (current) => {
          const url = `/api/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`;
          const updated = await fetcher(url);
          return { ...current, [path]: updated };
        },
        { revalidate: false },
      );
    },
    [sessionId, mutate],
  );

  useEffect(() => {
    const handler = (filePath: string) => {
      options?.onFileChange?.(filePath);
      const dir = parentDirectoryPath(filePath);
      void invalidate(dir);
    };
    fileChangeListeners.add(handler);
    return () => {
      fileChangeListeners.delete(handler);
    };
  }, [invalidate, options?.onFileChange]);

  return {
    expandedPaths,
    toggle,
    select,
    selectedPath,
    getChildren,
    hasLoaded,
    invalidate,
    isLoading,
    error,
    refresh: mutate,
  };
}

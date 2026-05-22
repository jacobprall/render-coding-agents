"use client";

import useSWR from "swr";
import { useEffect } from "react";

export interface GitChange {
  path: string;
  status: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface GitStatusResponse {
  branch: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
  clean: boolean;
}

const fetcher = async (url: string): Promise<GitStatusResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  return res.json() as Promise<GitStatusResponse>;
};

interface UseGitStatusOptions {
  sessionId: string;
  enabled: boolean;
}

const refreshListeners = new Set<() => void>();

export function notifyGitStatusRefresh() {
  for (const listener of refreshListeners) {
    listener();
  }
}

export function useGitStatus({ sessionId, enabled }: UseGitStatusOptions) {
  const { data, error, isLoading, mutate } = useSWR<GitStatusResponse>(
    enabled && sessionId ? `/api/sessions/${sessionId}/git/status` : null,
    fetcher,
    {
      refreshInterval: enabled ? 5000 : 0,
      revalidateOnFocus: false,
    },
  );

  useEffect(() => {
    const refresh = () => {
      void mutate();
    };
    refreshListeners.add(refresh);
    return () => {
      refreshListeners.delete(refresh);
    };
  }, [mutate]);

  return {
    status: data ?? null,
    refresh: mutate,
    isLoading,
    error,
  };
}

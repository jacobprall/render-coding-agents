"use client";

import { useEffect } from "react";
import useSWR from "swr";
import type { SessionTab } from "./session-tabs";

interface SessionFromApi {
  id: string;
  title: string | null;
  status: string;
  repoPath: string | null;
}

async function fetchRunningSessions(url: string): Promise<SessionFromApi[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions ?? [];
}

export function useSessionTabsSync() {
  const { data: runningSessions } = useSWR<SessionFromApi[]>(
    "/api/sessions?status=running&limit=20",
    fetchRunningSessions,
    {
      revalidateOnFocus: false,
      dedupingInterval: 30_000,
    }
  );

  useEffect(() => {
    if (!runningSessions || runningSessions.length === 0) return;
    const tabs = (window as unknown as Record<string, { addTab?: (t: SessionTab) => void }>).__sessionTabs;
    if (!tabs?.addTab) return;

    for (const s of runningSessions) {
      tabs.addTab({
        id: s.id,
        title: s.title || "Untitled",
        status: s.status,
        repoPath: s.repoPath,
      });
    }
  }, [runningSessions]);
}

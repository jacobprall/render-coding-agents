"use client";

import useSWR from "swr";
import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

export interface EventRow {
  id: string;
  sessionId: string;
  eventType: string;
  status: string;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  userName: string | null;
  trigger: string | null;
}

interface EventsResponse {
  items: EventRow[];
  nextCursor: string | null;
  total: number;
}

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`Failed to fetch: ${r.status}`);
  return r.json() as Promise<EventsResponse>;
});

export function useEvents() {
  const searchParams = useSearchParams();

  const buildUrl = useCallback(() => {
    const params = new URLSearchParams();
    const type = searchParams.get("type");
    const status = searchParams.get("status");
    const sessionId = searchParams.get("sessionId");
    const cursor = searchParams.get("cursor");
    const limit = searchParams.get("limit");

    if (type) params.set("type", type);
    if (status) params.set("status", status);
    if (sessionId) params.set("sessionId", sessionId);
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", limit);

    return `/api/observability/events?${params.toString()}`;
  }, [searchParams]);

  const { data, error, isLoading, mutate } = useSWR<EventsResponse>(
    buildUrl(),
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  return {
    events: data?.items ?? [],
    total: data?.total ?? 0,
    nextCursor: data?.nextCursor ?? null,
    isLoading,
    error,
    mutate,
  };
}

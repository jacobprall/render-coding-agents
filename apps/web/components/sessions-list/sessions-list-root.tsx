"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import {
  SessionsListConfigContext,
  SessionsListStateContext,
  type SessionFilter,
  type SessionGroup,
  type SessionItem,
} from "./sessions-list-context";

interface GroupedSessionsResponse {
  groups: SessionGroup[];
}

async function fetchGroupedSessions(url: string): Promise<SessionGroup[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as GroupedSessionsResponse;
  return data.groups ?? [];
}

interface SessionsListRootProps {
  children: ReactNode;
  defaultFilter?: SessionFilter;
  enabled?: boolean;
}

function SessionsListRoot({
  children,
  defaultFilter = "active",
  enabled = true,
}: SessionsListRootProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();

  const [filter, setFilter] = useState<SessionFilter>(defaultFilter);
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const swrKey = enabled
    ? `/api/sessions?limit=50&grouped=true&filter=${filter}`
    : null;

  const { data: groups, isLoading } = useSWR<SessionGroup[]>(
    swrKey,
    fetchGroupedSessions,
    { revalidateOnFocus: false, dedupingInterval: 10_000 },
  );

  const activeSessionId = pathname.startsWith("/sessions/")
    ? pathname.split("/")[2] ?? null
    : null;

  const invalidate = useCallback(() => {
    void globalMutate(
      (key) =>
        typeof key === "string" &&
        key.startsWith("/api/sessions") &&
        key.includes("grouped=true"),
    );
  }, [globalMutate]);

  const filteredGroups = useMemo(() => {
    if (!groups) return undefined;
    if (!query) return groups.filter((g) => g.sessions.length > 0);
    const q = query.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        sessions: g.sessions.filter(
          (s) =>
            (s.title?.toLowerCase().includes(q) ?? false) ||
            (s.repoPath?.toLowerCase().includes(q) ?? false),
        ),
      }))
      .filter((g) => g.sessions.length > 0);
  }, [groups, query]);

  const flatSessions = useMemo(
    () => filteredGroups?.flatMap((g) => g.sessions) ?? [],
    [filteredGroups],
  );

  const selectSession = useCallback(
    (id: string) => router.push(`/sessions/${id}`),
    [router],
  );

  const withAction = useCallback(
    (
      actionImport: () => Promise<(id: string, ...args: string[]) => Promise<{ error?: string }>>,
      id: string,
      extraArgs: string[] = [],
      navigateAwayIfActive = false,
    ) => {
      return (async () => {
        setPendingId(id);
        try {
          const action = await actionImport();
          const result = await action(id, ...extraArgs);
          if (!result.error) {
            invalidate();
            if (navigateAwayIfActive && id === activeSessionId) {
              router.push("/sessions");
            }
          }
        } finally {
          setPendingId(null);
        }
      })();
    },
    [activeSessionId, invalidate, router],
  );

  const archiveSession = useCallback(
    (id: string) =>
      withAction(
        () =>
          import("@/app/(authenticated)/sessions/actions").then(
            (m) => m.archiveSessionAction,
          ),
        id,
        [],
        true,
      ),
    [withAction],
  );

  const restoreSession = useCallback(
    (id: string) =>
      withAction(
        () =>
          import("@/app/(authenticated)/sessions/actions").then(
            (m) => m.restoreSessionAction,
          ),
        id,
      ),
    [withAction],
  );

  const deleteSession = useCallback(
    (id: string) =>
      withAction(
        () =>
          import("@/app/(authenticated)/sessions/actions").then(
            (m) => m.deleteSessionAction,
          ),
        id,
        [],
        true,
      ),
    [withAction],
  );

  const renameSession = useCallback(
    (id: string, title: string) =>
      withAction(
        () =>
          import("@/app/(authenticated)/sessions/actions").then(
            (m) => m.renameSessionAction as (id: string, ...args: string[]) => Promise<{ error?: string }>,
          ),
        id,
        [title],
      ),
    [withAction],
  );

  const configValue = useMemo(() => ({ filter }), [filter]);
  const stateValue = useMemo(
    () => ({
      query,
      setQuery,
      filter,
      setFilter,
      groups,
      filteredGroups,
      flatSessions,
      isLoading,
      activeSessionId,
      pendingId,
      archiveSession,
      restoreSession,
      deleteSession,
      renameSession,
      invalidate,
      selectSession,
    }),
    [
      query,
      filter,
      groups,
      filteredGroups,
      flatSessions,
      isLoading,
      activeSessionId,
      pendingId,
      archiveSession,
      restoreSession,
      deleteSession,
      renameSession,
      invalidate,
      selectSession,
    ],
  );

  return (
    <SessionsListConfigContext.Provider value={configValue}>
      <SessionsListStateContext.Provider value={stateValue}>
        {children}
      </SessionsListStateContext.Provider>
    </SessionsListConfigContext.Provider>
  );
}
SessionsListRoot.displayName = "SessionsList.Root";

export { SessionsListRoot };

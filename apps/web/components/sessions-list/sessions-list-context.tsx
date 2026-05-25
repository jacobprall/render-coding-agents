"use client";

import { createContext, useContext } from "react";

export interface SessionItem {
  id: string;
  title: string | null;
  status: string;
  repoPath: string | null;
  lastActivityAt: string | null;
  createdAt: string;
}

export interface SessionGroup {
  repoPath: string | null;
  label?: string;
  sessions: SessionItem[];
}

export type SessionFilter = "active" | "archived";

export interface SessionsListConfigContextValue {
  filter: SessionFilter;
}

export interface SessionsListStateContextValue {
  query: string;
  setQuery: (q: string) => void;
  filter: SessionFilter;
  setFilter: (f: SessionFilter | ((prev: SessionFilter) => SessionFilter)) => void;
  groups: SessionGroup[] | undefined;
  filteredGroups: SessionGroup[] | undefined;
  flatSessions: SessionItem[];
  isLoading: boolean;
  activeSessionId: string | null;
  pendingId: string | null;
  archiveSession: (id: string) => Promise<void>;
  restoreSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  invalidate: () => void;
  selectSession: (id: string) => void;
}

export const SessionsListConfigContext =
  createContext<SessionsListConfigContextValue | null>(null);

export const SessionsListStateContext =
  createContext<SessionsListStateContextValue | null>(null);

export function useSessionsListConfig() {
  const ctx = useContext(SessionsListConfigContext);
  if (!ctx) throw new Error("Must be used within SessionsList.Root");
  return ctx;
}

export function useSessionsListState() {
  const ctx = useContext(SessionsListStateContext);
  if (!ctx) throw new Error("Must be used within SessionsList.Root");
  return ctx;
}

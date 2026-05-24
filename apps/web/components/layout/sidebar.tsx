"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Archive,
  Filter,
  RotateCcw,
  Pencil,
  Trash2,
} from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SidebarSession {
  id: string;
  title: string | null;
  status: string;
  repoPath: string | null;
  lastActivityAt: string | null;
  createdAt: string;
}

interface SessionGroup {
  repoPath: string | null;
  label?: string;
  sessions: SidebarSession[];
}

interface GroupedSessionsResponse {
  groups: SessionGroup[];
}

type SessionFilter = "active" | "archived";

async function fetchGroupedSessions(url: string): Promise<SessionGroup[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as GroupedSessionsResponse;
  return data.groups ?? [];
}

function repoSlug(repoPath: string | null): string {
  if (!repoPath) return "Scratch";
  const parts = repoPath.split("/");
  return parts[parts.length - 1] || repoPath;
}

const statusDot: Record<string, string> = {
  running: "bg-teal-500 animate-pulse",
  completed: "bg-primary",
  failed: "bg-destructive",
  idle: "bg-muted-foreground",
  paused: "bg-yellow-500",
  archived: "bg-muted-foreground",
};

interface SidebarProps {
  user: {
    username: string;
    avatarUrl: string;
  };
  open: boolean;
}

export function Sidebar({ user, open }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const sidebarRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionItemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { mutate } = useSWRConfig();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SessionFilter>("active");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SidebarSession | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    session: SidebarSession;
    x: number;
    y: number;
  } | null>(null);

  const swrKey = open
    ? `/api/sessions?limit=50&grouped=true&filter=${filter}`
    : null;

  const { data: groups } = useSWR<SessionGroup[]>(swrKey, fetchGroupedSessions, {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  });

  const activeSessionId = pathname.startsWith("/sessions/")
    ? pathname.split("/")[2]
    : null;

  const invalidateSessions = useCallback(() => {
    void mutate(
      (key) =>
        typeof key === "string" &&
        key.startsWith("/api/sessions") &&
        key.includes("grouped=true"),
    );
  }, [mutate]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        router.push("/sessions");
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [router]);

  const filteredGroups = groups
    ?.map((group) => ({
      ...group,
      sessions: group.sessions.filter((s) => {
        if (!query) return true;
        const q = query.toLowerCase();
        return (
          (s.title?.toLowerCase().includes(q) ?? false) ||
          (s.repoPath?.toLowerCase().includes(q) ?? false)
        );
      }),
    }))
    .filter((group) => group.sessions.length > 0);

  const flatSessions = useMemo(
    () => filteredGroups?.flatMap((group) => group.sessions) ?? [],
    [filteredGroups],
  );

  useEffect(() => {
    sessionItemRefs.current = sessionItemRefs.current.slice(0, flatSessions.length);
    if (focusedIndex >= flatSessions.length) {
      setFocusedIndex(flatSessions.length > 0 ? flatSessions.length - 1 : -1);
    }
  }, [flatSessions.length, focusedIndex]);

  useEffect(() => {
    if (focusedIndex >= 0) {
      sessionItemRefs.current[focusedIndex]?.focus();
    }
  }, [focusedIndex]);

  const blurSidebar = useCallback(() => {
    const active = document.activeElement;
    if (sidebarRef.current?.contains(active)) {
      (active as HTMLElement).blur();
    }
    setFocusedIndex(-1);
  }, []);

  const handleEscape = useCallback(() => {
    if (query) {
      setQuery("");
      inputRef.current?.focus();
      setFocusedIndex(-1);
      return;
    }
    blurSidebar();
  }, [blurSidebar, query]);

  const handleSelect = useCallback(
    (id: string) => {
      router.push(`/sessions/${id}`);
    },
    [router],
  );

  const handleSessionKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number, sessionId: string) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((current) =>
            current < flatSessions.length - 1 ? current + 1 : current,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((current) => (current > 0 ? current - 1 : 0));
          break;
        case "Enter":
          e.preventDefault();
          handleSelect(sessionId);
          break;
        case "Escape":
          e.preventDefault();
          handleEscape();
          break;
      }
    },
    [flatSessions.length, handleEscape, handleSelect],
  );

  const handleArchive = useCallback(
    async (id: string) => {
      setPendingId(id);
      try {
        const { archiveSessionAction } = await import(
          "@/app/(authenticated)/sessions/actions"
        );
        const result = await archiveSessionAction(id);
        if (!result.error) {
          invalidateSessions();
          if (id === activeSessionId) {
            router.push("/sessions");
          }
        }
      } finally {
        setPendingId(null);
      }
    },
    [activeSessionId, invalidateSessions, router],
  );

  const handleRestore = useCallback(
    async (id: string) => {
      setPendingId(id);
      try {
        const { restoreSessionAction } = await import(
          "@/app/(authenticated)/sessions/actions"
        );
        const result = await restoreSessionAction(id);
        if (!result.error) {
          invalidateSessions();
        }
      } finally {
        setPendingId(null);
      }
    },
    [invalidateSessions],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setPendingId(id);
      try {
        const { deleteSessionAction } = await import(
          "@/app/(authenticated)/sessions/actions"
        );
        const result = await deleteSessionAction(id);
        if (!result.error) {
          setDeleteTarget(null);
          invalidateSessions();
          if (id === activeSessionId) {
            router.push("/sessions");
          }
        }
      } finally {
        setPendingId(null);
      }
    },
    [activeSessionId, invalidateSessions, router],
  );

  const startRename = useCallback((session: SidebarSession) => {
    setRenamingId(session.id);
    setRenameValue(session.title || "Untitled");
    setContextMenu(null);
  }, []);

  const submitRename = useCallback(
    async (id: string) => {
      const trimmed = renameValue.trim();
      if (!trimmed) {
        setRenamingId(null);
        return;
      }
      setPendingId(id);
      try {
        const { renameSessionAction } = await import(
          "@/app/(authenticated)/sessions/actions"
        );
        const result = await renameSessionAction(id, trimmed);
        if (!result.error) {
          setRenamingId(null);
          invalidateSessions();
        }
      } finally {
        setPendingId(null);
      }
    },
    [invalidateSessions, renameValue],
  );

  const renderSessionItem = (session: SidebarSession, index: number) => {
    const isActive = session.id === activeSessionId;
    const isPending = pendingId === session.id;
    const isRenaming = renamingId === session.id;
    const isArchivedView = filter === "archived";
    const isKeyboardFocused = focusedIndex === index;

    if (isRenaming) {
      return (
        <div key={session.id} className="px-3 py-1.5">
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitRename(session.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={() => void submitRename(session.id)}
            className="w-full border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      );
    }

    return (
      <button
        key={session.id}
        ref={(el) => {
          sessionItemRefs.current[index] = el;
        }}
        type="button"
        tabIndex={isKeyboardFocused ? 0 : -1}
        onClick={() => handleSelect(session.id)}
        onFocus={() => setFocusedIndex(index)}
        onKeyDown={(e) => handleSessionKeyDown(e, index, session.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ session, x: e.clientX, y: e.clientY });
        }}
        disabled={isPending}
        className={cn(
          "group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
          isPending && "pointer-events-none opacity-40",
          isActive
            ? "bg-primary/10 text-foreground"
            : isKeyboardFocused
              ? "bg-muted/50 text-foreground"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            session.status === "running"
              ? "bg-teal-500 animate-pulse"
              : statusDot[session.status] ?? "bg-muted-foreground",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {session.title || "Untitled"}
        </span>
        {!isArchivedView ? (
          <span
            role="button"
            tabIndex={-1}
            title="Archive session"
            onClick={(e) => {
              e.stopPropagation();
              void handleArchive(session.id);
            }}
            className="hidden shrink-0 p-0.5 opacity-50 transition-opacity hover:opacity-100 group-hover:inline-flex"
          >
            <Archive className="h-3 w-3" />
          </span>
        ) : (
          <span
            role="button"
            tabIndex={-1}
            title="Restore session"
            onClick={(e) => {
              e.stopPropagation();
              void handleRestore(session.id);
            }}
            className="hidden shrink-0 p-0.5 opacity-50 transition-opacity hover:opacity-100 group-hover:inline-flex"
          >
            <RotateCcw className="h-3 w-3" />
          </span>
        )}
      </button>
    );
  };

  return (
    <aside
      ref={sidebarRef}
      className={cn(
        "flex h-full min-w-0 flex-col overflow-hidden border-r border-border bg-card",
        !open && "pointer-events-none invisible",
      )}
      aria-hidden={!open}
      onKeyDown={(e) => {
        if (e.key === "Escape") handleEscape();
      }}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <Link
          href="/sessions"
          className="inline-flex items-center gap-1.5 bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          New Agent
          <kbd className="ml-1 hidden rounded bg-primary-foreground/15 px-1 py-0.5 font-mono text-[10px] text-primary-foreground/80 sm:inline">
            ⌘N
          </kbd>
        </Link>
        <button
          type="button"
          title={filter === "active" ? "Show archived sessions" : "Show active sessions"}
          onClick={() =>
            setFilter((current) => (current === "active" ? "archived" : "active"))
          }
          className={cn(
            "flex h-7 w-7 items-center justify-center transition-colors",
            filter === "archived"
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          <Filter className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                handleEscape();
              } else if (e.key === "ArrowDown" && flatSessions.length > 0) {
                e.preventDefault();
                setFocusedIndex(0);
              }
            }}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!filteredGroups ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-muted/40" />
            ))}
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {query
              ? "No matching sessions"
              : filter === "archived"
                ? "No archived sessions"
                : "No sessions yet"}
          </div>
        ) : (
          <div className="py-1" role="list">
            {(() => {
              let sessionIndex = 0;
              return filteredGroups.map((group) => {
                const groupStartIndex = sessionIndex;
                sessionIndex += group.sessions.length;

                return (
                  <div key={group.repoPath ?? "scratch"} className="mb-2">
                    <p className="px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                      {group.label ?? repoSlug(group.repoPath)}
                    </p>
                    {group.sessions.map((session, i) =>
                      renderSessionItem(session, groupStartIndex + i),
                    )}
                  </div>
                );
              });
            })()}
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-2">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 transition-colors hover:bg-muted/50"
        >
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="h-7 w-7 shrink-0"
            />
          ) : (
            <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-muted text-xs font-medium text-muted-foreground">
              {user.username.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">{user.username}</p>
          </div>
        </Link>
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete session?</DialogTitle>
            <DialogDescription>
              This will permanently remove &ldquo;{deleteTarget?.title || "Untitled"}&rdquo; from
              your sidebar. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={pendingId === deleteTarget?.id}
              onClick={() => deleteTarget && void handleDelete(deleteTarget.id)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {contextMenu ? (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 min-w-[8rem] border border-border bg-popover p-1 shadow-md"
            style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            <button
              type="button"
              className="flex w-full items-center px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => startRename(contextMenu.session)}
            >
              <Pencil className="mr-2 h-3 w-3" />
              Rename
            </button>
            {filter === "archived" ? (
              <button
                type="button"
                className="flex w-full items-center px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  void handleRestore(contextMenu.session.id);
                  setContextMenu(null);
                }}
              >
                <RotateCcw className="mr-2 h-3 w-3" />
                Restore
              </button>
            ) : (
              <button
                type="button"
                className="flex w-full items-center px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  void handleArchive(contextMenu.session.id);
                  setContextMenu(null);
                }}
              >
                <Archive className="mr-2 h-3 w-3" />
                Archive
              </button>
            )}
            <div className="-mx-1 my-1 h-px bg-border" />
            <button
              type="button"
              className="flex w-full items-center px-2 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-accent"
              onClick={() => {
                setDeleteTarget(contextMenu.session);
                setContextMenu(null);
              }}
            >
              <Trash2 className="mr-2 h-3 w-3" />
              Delete
            </button>
          </div>
        </>
      ) : null}
    </aside>
  );
}

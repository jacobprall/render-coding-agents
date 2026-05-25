"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Archive, RotateCcw, Pencil, Trash2 } from "lucide-react";
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
import {
  SessionsList,
  useSessionsListState,
  type SessionItem,
} from "@/components/sessions-list";

interface SidebarProps {
  user: {
    username: string;
    avatarUrl: string;
  };
  open: boolean;
}

export function Sidebar({ user, open }: SidebarProps) {
  return (
    <SessionsList.Root enabled={open}>
      <SidebarInner user={user} open={open} />
    </SessionsList.Root>
  );
}

function SidebarInner({
  user,
  open,
}: SidebarProps) {
  const router = useRouter();
  const sidebarRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionItemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const {
    flatSessions,
    activeSessionId,
    filter,
    pendingId,
    archiveSession,
    restoreSession,
    deleteSession,
    renameSession: renameSessionAction,
    selectSession,
  } = useSessionsListState();

  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    session: SessionItem;
    x: number;
    y: number;
  } | null>(null);

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
    blurSidebar();
  }, [blurSidebar]);

  const handleSessionKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number, sessionId: string) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((c) => (c < flatSessions.length - 1 ? c + 1 : c));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((c) => (c > 0 ? c - 1 : 0));
          break;
        case "Enter":
          e.preventDefault();
          selectSession(sessionId);
          break;
        case "Escape":
          e.preventDefault();
          handleEscape();
          break;
      }
    },
    [flatSessions.length, handleEscape, selectSession],
  );

  const startRename = useCallback((session: SessionItem) => {
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
      await renameSessionAction(id, trimmed);
      setRenamingId(null);
    },
    [renameSessionAction, renameValue],
  );

  const isArchivedView = filter === "archived";

  const renderSessionItem = (session: SessionItem, index: number) => {
    const isActive = session.id === activeSessionId;
    const isRenaming = renamingId === session.id;
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
      <SessionsList.Item
        key={session.id}
        ref={(el) => {
          sessionItemRefs.current[index] = el;
        }}
        session={session}
        active={isActive}
        focused={isKeyboardFocused}
        onFocus={() => setFocusedIndex(index)}
        onKeyDown={(e) => handleSessionKeyDown(e, index, session.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ session, x: e.clientX, y: e.clientY });
        }}
        actions={
          !isArchivedView ? (
            <span
              role="button"
              tabIndex={-1}
              title="Archive session"
              onClick={(e) => {
                e.stopPropagation();
                void archiveSession(session.id);
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
                void restoreSession(session.id);
              }}
              className="hidden shrink-0 p-0.5 opacity-50 transition-opacity hover:opacity-100 group-hover:inline-flex"
            >
              <RotateCcw className="h-3 w-3" />
            </span>
          )
        }
      />
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
        <SessionsList.Filter className="h-7 w-7" />
      </div>

      <div className="border-b border-border px-3 py-2">
        <SessionsList.Search
          ref={inputRef}
          className="rounded bg-muted/50 px-2 py-1"
          onEscape={handleEscape}
          onArrowDown={() => {
            if (flatSessions.length > 0) setFocusedIndex(0);
          }}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <SessionsList.Groups renderItem={renderSessionItem} />
        <SessionsList.Empty />
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

      <Dialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
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
              onClick={() => deleteTarget && void deleteSession(deleteTarget.id)}
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
            className="fixed z-50 min-w-32 border border-border bg-popover p-1 shadow-md"
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
            {isArchivedView ? (
              <button
                type="button"
                className="flex w-full items-center px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground"
                onClick={() => {
                  void restoreSession(contextMenu.session.id);
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
                  void archiveSession(contextMenu.session.id);
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

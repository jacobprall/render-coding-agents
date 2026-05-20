"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, Plus, X, Archive } from "lucide-react";
import useSWR, { useSWRConfig } from "swr";
import { cn } from "@/lib/utils";

interface DrawerSession {
  id: string;
  title: string | null;
  status: string;
  repoPath: string | null;
  lastActivityAt: string | null;
  createdAt: string;
}

async function fetchSessions(url: string): Promise<DrawerSession[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions ?? [];
}

function relativeTime(date: string | null): string {
  if (!date) return "";
  const diff = Date.now() - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

const statusDot: Record<string, string> = {
  running: "bg-green-500",
  completed: "bg-primary",
  failed: "bg-destructive",
  idle: "bg-muted-foreground",
  paused: "bg-yellow-500",
};

interface SessionDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function SessionDrawer({ open, onClose }: SessionDrawerProps) {
  const pathname = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");

  const { data: sessions } = useSWR<DrawerSession[]>(
    open ? "/api/sessions?limit=50" : null,
    fetchSessions,
    { revalidateOnFocus: false, dedupingInterval: 10_000 },
  );

  const filtered = sessions?.filter((s) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      (s.title?.toLowerCase().includes(q) ?? false) ||
      (s.repoPath?.toLowerCase().includes(q) ?? false)
    );
  });

  const activeSessionId = pathname.startsWith("/sessions/")
    ? pathname.split("/")[2]
    : null;

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const { mutate } = useSWRConfig();
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const handleSelect = useCallback(
    (id: string) => {
      router.push(`/sessions/${id}`);
      onClose();
    },
    [router, onClose],
  );

  const handleArchive = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setArchivingId(id);
      try {
        const { archiveSessionAction } = await import(
          "@/app/(authenticated)/sessions/actions"
        );
        const result = await archiveSessionAction(id);
        if (!result.error) {
          void mutate("/api/sessions?limit=50");
          if (id === activeSessionId) {
            router.push("/sessions");
          }
        }
      } finally {
        setArchivingId(null);
      }
    },
    [mutate, activeSessionId, router],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className="fixed left-12 top-0 z-40 flex h-screen w-72 flex-col border-r border-border bg-card shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="font-mono text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Sessions
          </span>
          <div className="flex items-center gap-1">
            <Link
              href="/sessions"
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </Link>
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="border-b border-border px-3 py-2">
          <div className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions…"
              className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto">
          {!filtered ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-muted/40" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">
              {query ? "No matching sessions" : "No sessions yet"}
            </div>
          ) : (
            <div className="py-1">
              {filtered.map((s) => {
                const isActive = s.id === activeSessionId;
                const isArchiving = archivingId === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => handleSelect(s.id)}
                    className={cn(
                      "group flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                      isArchiving && "opacity-40 pointer-events-none",
                      isActive
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        statusDot[s.status] ?? "bg-muted-foreground",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">
                        {s.title || "Untitled"}
                      </p>
                      <p className="truncate text-[10px] font-mono opacity-60">
                        {s.repoPath ?? "scratch"}
                      </p>
                    </div>
                    <span
                      className="shrink-0 text-[10px] tabular-nums opacity-50 group-hover:hidden"
                      suppressHydrationWarning
                    >
                      {relativeTime(s.lastActivityAt ?? s.createdAt)}
                    </span>
                    <span
                      role="button"
                      tabIndex={-1}
                      title="Archive session"
                      onClick={(e) => void handleArchive(e, s.id)}
                      className="hidden shrink-0 p-0.5 opacity-50 transition-opacity hover:opacity-100 group-hover:inline-flex"
                    >
                      <Archive className="h-3 w-3" />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-3 py-2">
          <Link
            href="/sessions"
            onClick={onClose}
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            View all sessions
          </Link>
        </div>
      </div>
    </>
  );
}

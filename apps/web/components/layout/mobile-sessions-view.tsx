"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Plus,
  Archive,
  Search,
  Activity,
  Zap,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Loader2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

interface Session {
  id: string;
  title?: string | null;
  repoPath?: string | null;
  status: string;
  lastActivityAt?: string | null;
  createdAt?: string | null;
}

interface GroupedSessions {
  groups: { repoPath: string | null; label?: string; sessions: Session[] }[];
}

function fetcher(url: string) {
  return apiFetch<GroupedSessions>(url).then((r) => r.data);
}

interface MobileSessionsViewProps {
  onClose?: () => void;
}

const PULL_TRIGGER_PX = 70;
const PULL_RESIST = 0.45;

function formatRelativeTime(input: string | null | undefined): string {
  if (!input) return "";
  const ts = new Date(input).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type StatusToken = {
  label: string;
  dotClass: string;
  textClass: string;
  pillClass: string;
  Icon: typeof Loader2;
};

function statusToken(status: string): StatusToken {
  switch (status) {
    case "running":
      return {
        label: "Running",
        dotClass: "bg-success",
        textClass: "text-success",
        pillClass: "bg-success/10 text-success border-success/30",
        Icon: Loader2,
      };
    case "completed":
      return {
        label: "Completed",
        dotClass: "bg-accent",
        textClass: "text-accent-text",
        pillClass: "bg-accent/10 text-accent-text border-accent/30",
        Icon: CheckCircle2,
      };
    case "failed":
      return {
        label: "Failed",
        dotClass: "bg-danger",
        textClass: "text-danger",
        pillClass: "bg-danger/10 text-danger border-danger/30",
        Icon: XCircle,
      };
    case "queued":
    case "pending":
      return {
        label: "Queued",
        dotClass: "bg-warning",
        textClass: "text-warning",
        pillClass: "bg-warning/10 text-warning border-warning/30",
        Icon: AlertTriangle,
      };
    case "archived":
      return {
        label: "Archived",
        dotClass: "bg-text-tertiary",
        textClass: "text-text-tertiary",
        pillClass: "bg-surface-2 text-text-tertiary border-stroke-subtle",
        Icon: Archive,
      };
    default:
      return {
        label: status || "Idle",
        dotClass: "bg-muted-foreground/40",
        textClass: "text-text-tertiary",
        pillClass: "bg-surface-2 text-text-tertiary border-stroke-subtle",
        Icon: Inbox,
      };
  }
}

function SessionCard({
  session,
  onSelect,
}: {
  session: Session;
  onSelect: (id: string) => void;
}) {
  const token = statusToken(session.status);
  const Icon = token.Icon;
  const repoLabel = session.repoPath ?? "scratch";

  return (
    <button
      type="button"
      onClick={() => onSelect(session.id)}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
        "min-h-[64px] active:bg-surface-1",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center border border-stroke-subtle",
          session.status === "running" ? "bg-success/10" : "bg-surface-1",
        )}
      >
        <Icon
          className={cn(
            "size-4",
            token.textClass,
            session.status === "running" && "animate-spin",
          )}
          strokeWidth={1.8}
        />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="truncate text-sm font-medium text-foreground">
            {session.title ?? "Untitled session"}
          </p>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              token.dotClass,
              session.status === "running" && "animate-pulse",
            )}
          />
          <span className={cn("font-medium", token.textClass)}>{token.label}</span>
          <span className="text-text-tertiary">·</span>
          <span
            className="truncate font-mono text-text-tertiary"
            title={repoLabel}
          >
            {repoLabel}
          </span>
        </div>
      </div>

      <span
        className="shrink-0 text-[11px] tabular-nums text-text-tertiary"
        suppressHydrationWarning
      >
        {formatRelativeTime(session.lastActivityAt ?? session.createdAt)}
      </span>
    </button>
  );
}

function SessionCardSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 min-h-[64px]">
      <div className="h-9 w-9 shrink-0 animate-pulse bg-surface-1" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="h-3.5 w-2/3 animate-pulse bg-surface-1" />
        <div className="h-2.5 w-1/3 animate-pulse bg-surface-1" />
      </div>
      <div className="h-2.5 w-10 shrink-0 animate-pulse bg-surface-1" />
    </div>
  );
}

export function MobileSessionsView({ onClose }: MobileSessionsViewProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");

  const { data, isLoading, mutate, isValidating } = useSWR(
    `/api/sessions?limit=50&grouped=true&filter=${filter}`,
    fetcher,
    { revalidateOnFocus: true },
  );

  // Pull-to-refresh
  const scrollRef = useRef<HTMLDivElement>(null);
  const pullStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  async function triggerRefresh() {
    setRefreshing(true);
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate?.(8);
        } catch {
          // ignore
        }
      }
      await mutate();
    } finally {
      setRefreshing(false);
      setPullDistance(0);
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    const el = scrollRef.current;
    if (!el || refreshing) return;
    if (el.scrollTop > 0) {
      pullStartY.current = null;
      return;
    }
    pullStartY.current = e.touches[0]?.clientY ?? null;
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (pullStartY.current == null) return;
    const y = e.touches[0]?.clientY ?? pullStartY.current;
    const delta = y - pullStartY.current;
    if (delta <= 0) {
      setPullDistance(0);
      return;
    }
    setPullDistance(Math.min(120, delta * PULL_RESIST));
  }

  function handleTouchEnd() {
    if (pullStartY.current == null) return;
    pullStartY.current = null;
    if (pullDistance >= PULL_TRIGGER_PX) {
      void triggerRefresh();
    } else {
      setPullDistance(0);
    }
  }

  function handleSelect(id: string) {
    router.push(`/sessions/${id}`);
    onClose?.();
  }

  function handleNewSession() {
    router.push("/sessions");
    onClose?.();
  }

  const groups = data?.groups ?? [];
  const filteredGroups = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups
      .map((g) => ({
        ...g,
        sessions: g.sessions.filter((s) =>
          (s.title ?? "Untitled").toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.sessions.length > 0);
  }, [groups, search]);

  const totalCount = useMemo(
    () => filteredGroups.reduce((sum, g) => sum + g.sessions.length, 0),
    [filteredGroups],
  );
  const runningCount = useMemo(
    () =>
      filteredGroups.reduce(
        (sum, g) => sum + g.sessions.filter((s) => s.status === "running").length,
        0,
      ),
    [filteredGroups],
  );

  // Re-render every 30s so "time ago" stays fresh.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  return (
    <div className="flex h-full flex-col bg-background">
      <div
        className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2"
        style={{ paddingTop: "calc(var(--safe-area-top, 0px) + 8px)" }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className={cn(
              "h-11 w-full bg-surface-1 pl-10 pr-3 text-sm text-foreground placeholder-muted-foreground",
              "outline-none border border-border focus:border-primary/40",
            )}
          />
        </div>
        <button
          type="button"
          onClick={() => setFilter(filter === "active" ? "archived" : "active")}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center border border-border transition-colors",
            filter === "archived"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground active:bg-surface-1",
          )}
          aria-pressed={filter === "archived"}
          aria-label={filter === "archived" ? "Show active sessions" : "Show archived sessions"}
        >
          <Archive className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-border px-3 py-2">
        <Link
          href="/observability"
          className="flex min-h-[44px] items-center gap-2 border border-border bg-card px-3 py-2.5 transition-colors active:bg-surface-1"
        >
          <Activity className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">Observability</p>
            <p className="text-[10px] text-muted-foreground">Events & usage</p>
          </div>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
        </Link>
        <Link
          href="/automations"
          className="flex min-h-[44px] items-center gap-2 border border-border bg-card px-3 py-2.5 transition-colors active:bg-surface-1"
        >
          <Zap className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">Automations</p>
            <p className="text-[10px] text-muted-foreground">Triggers & runs</p>
          </div>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
        </Link>
      </div>

      <div className="flex shrink-0 items-center justify-between px-3 py-1.5 text-[11px] text-text-tertiary">
        <span className="tabular-nums">
          {totalCount} {filter === "archived" ? "archived" : "active"} ·{" "}
          <span className={runningCount > 0 ? "text-success" : "text-text-tertiary"}>
            {runningCount} running
          </span>
        </span>
        {(refreshing || isValidating) && !isLoading ? (
          <span className="inline-flex items-center gap-1 text-text-tertiary">
            <Loader2 className="size-3 animate-spin" />
            Updating…
          </span>
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-center overflow-hidden",
            "text-[11px] text-text-tertiary transition-opacity",
            pullDistance > 0 || refreshing ? "opacity-100" : "opacity-0",
          )}
          style={{
            height: `${Math.max(pullDistance, refreshing ? PULL_TRIGGER_PX : 0)}px`,
          }}
          aria-hidden
        >
          <div className="inline-flex items-center gap-1.5">
            <Loader2
              className={cn(
                "size-3",
                refreshing
                  ? "animate-spin"
                  : pullDistance >= PULL_TRIGGER_PX
                    ? "rotate-180 text-primary"
                    : "",
              )}
              style={
                !refreshing && pullDistance < PULL_TRIGGER_PX
                  ? { transform: `rotate(${pullDistance * 4}deg)` }
                  : undefined
              }
            />
            {refreshing
              ? "Refreshing…"
              : pullDistance >= PULL_TRIGGER_PX
                ? "Release to refresh"
                : "Pull to refresh"}
          </div>
        </div>

        <div
          ref={scrollRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          className="h-full overflow-y-auto overscroll-contain"
          style={{
            transform: `translateY(${refreshing ? PULL_TRIGGER_PX : pullDistance}px)`,
            transition: pullStartY.current == null ? "transform 180ms ease" : "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {isLoading ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 8 }).map((_, i) => (
                <SessionCardSkeleton key={i} />
              ))}
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <Inbox className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {filter === "archived"
                    ? "No archived sessions"
                    : search
                      ? "No matches"
                      : "No sessions yet"}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {filter === "archived"
                    ? "Archived sessions will appear here."
                    : search
                      ? "Try a different search."
                      : "Start your first agent to see it listed."}
                </p>
              </div>
              {!search && filter === "active" ? (
                <button
                  type="button"
                  onClick={handleNewSession}
                  className="mt-2 inline-flex min-h-[44px] items-center justify-center gap-2 bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors active:bg-primary/80"
                >
                  <Plus className="size-4" />
                  Start your first agent
                </button>
              ) : null}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredGroups.map((group) => (
                <div key={group.repoPath ?? "scratch"}>
                  <p className="sticky top-0 z-1 border-b border-border bg-background/95 backdrop-blur px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.label ?? group.repoPath ?? "Scratch"}
                  </p>
                  {group.sessions.map((session) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      onSelect={handleSelect}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <button
          type="button"
          onClick={handleNewSession}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 bg-primary py-3 text-sm font-semibold text-white transition-colors active:bg-primary/80"
        >
          <Plus className="size-4" />
          New Agent
        </button>
      </div>
    </div>
  );
}

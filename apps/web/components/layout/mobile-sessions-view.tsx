"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Archive,
  Search,
  Activity,
  Zap,
  ArrowRight,
  Inbox,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SessionsList,
  useSessionsListState,
  type SessionItem,
  STATUS_DOT,
  formatRelativeTime,
} from "@/components/sessions-list";

interface MobileSessionsViewProps {
  onClose?: () => void;
}

const PULL_TRIGGER_PX = 70;
const PULL_RESIST = 0.45;

type StatusToken = {
  label: string;
  dotClass: string;
  textClass: string;
  Icon: typeof Loader2;
};

function statusToken(status: string): StatusToken {
  switch (status) {
    case "running":
      return { label: "Running", dotClass: "bg-success", textClass: "text-success", Icon: Loader2 };
    case "completed":
      return { label: "Completed", dotClass: "bg-accent", textClass: "text-accent-text", Icon: CheckCircle2 };
    case "failed":
      return { label: "Failed", dotClass: "bg-danger", textClass: "text-danger", Icon: XCircle };
    case "queued":
    case "pending":
      return { label: "Queued", dotClass: "bg-warning", textClass: "text-warning", Icon: AlertTriangle };
    case "archived":
      return { label: "Archived", dotClass: "bg-text-tertiary", textClass: "text-text-tertiary", Icon: Archive };
    default:
      return { label: status || "Idle", dotClass: "bg-muted-foreground/40", textClass: "text-text-tertiary", Icon: Inbox };
  }
}

function MobileSessionCard({
  session,
  onSelect,
}: {
  session: SessionItem;
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
          className={cn("size-4", token.textClass, session.status === "running" && "animate-spin")}
          strokeWidth={1.8}
        />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {session.title ?? "Untitled session"}
        </p>
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
          <span className="text-text-tertiary">&middot;</span>
          <span className="truncate font-mono text-text-tertiary" title={repoLabel}>
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

function MobileSessionCardSkeleton() {
  return (
    <div className="flex min-h-[64px] items-center gap-3 px-4 py-3">
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
  return (
    <SessionsList.Root>
      <MobileSessionsViewInner onClose={onClose} />
    </SessionsList.Root>
  );
}

function MobileSessionsViewInner({ onClose }: MobileSessionsViewProps) {
  const router = useRouter();
  const {
    query,
    setQuery,
    filter,
    setFilter,
    filteredGroups,
    isLoading,
    invalidate,
    flatSessions,
  } = useSessionsListState();

  const scrollRef = useRef<HTMLDivElement>(null);
  const pullStartY = useRef<number | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [isValidating, setIsValidating] = useState(false);

  async function triggerRefresh() {
    setRefreshing(true);
    try {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try { navigator.vibrate?.(8); } catch { /* ignore */ }
      }
      invalidate();
    } finally {
      setRefreshing(false);
      setPullDistance(0);
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    const el = scrollRef.current;
    if (!el || refreshing) return;
    if (el.scrollTop > 0) { pullStartY.current = null; return; }
    pullStartY.current = e.touches[0]?.clientY ?? null;
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (pullStartY.current == null) return;
    const y = e.touches[0]?.clientY ?? pullStartY.current;
    const delta = y - pullStartY.current;
    if (delta <= 0) { setPullDistance(0); return; }
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

  const totalCount = flatSessions.length;
  const runningCount = useMemo(
    () => flatSessions.filter((s) => s.status === "running").length,
    [flatSessions],
  );

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const groups = filteredGroups ?? [];

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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className={cn(
              "h-11 w-full bg-surface-1 pl-10 pr-3 text-sm text-foreground placeholder-muted-foreground",
              "outline-none border border-border focus:border-primary/40",
            )}
          />
        </div>
        <SessionsList.Filter className="h-11 w-11 shrink-0 border border-border" variant="icon-archive" />
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-border px-3 py-2">
        <Link
          href="/observability"
          className="flex min-h-[44px] items-center gap-2 border border-border bg-card px-3 py-2.5 transition-colors active:bg-surface-1"
        >
          <Activity className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">Observability</p>
            <p className="text-[10px] text-muted-foreground">Events &amp; usage</p>
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
            <p className="text-[10px] text-muted-foreground">Triggers &amp; runs</p>
          </div>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
        </Link>
      </div>

      <div className="flex shrink-0 items-center justify-between px-3 py-1.5 text-[11px] text-text-tertiary">
        <span className="tabular-nums">
          {totalCount} {filter === "archived" ? "archived" : "active"} &middot;{" "}
          <span className={runningCount > 0 ? "text-success" : "text-text-tertiary"}>
            {runningCount} running
          </span>
        </span>
        {refreshing && !isLoading ? (
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
                <MobileSessionCardSkeleton key={i} />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <Inbox className="size-8 text-muted-foreground/50" strokeWidth={1.5} />
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {filter === "archived"
                    ? "No archived sessions"
                    : query
                      ? "No matches"
                      : "No sessions yet"}
                </p>
                <p className="text-[12px] text-muted-foreground">
                  {filter === "archived"
                    ? "Archived sessions will appear here."
                    : query
                      ? "Try a different search."
                      : "Start your first agent to see it listed."}
                </p>
              </div>
              {!query && filter === "active" ? (
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
              {groups.map((group) => (
                <div key={group.repoPath ?? "scratch"}>
                  <p className="sticky top-0 z-1 border-b border-border bg-background/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
                    {group.label ?? group.repoPath ?? "Scratch"}
                  </p>
                  {group.sessions.map((session) => (
                    <MobileSessionCard
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

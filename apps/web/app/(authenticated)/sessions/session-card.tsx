"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Archive } from "lucide-react";
import type { Session } from "@coding-agents/db/schema";
import { archiveSessionAction } from "./actions";

export type SessionCardSession = Pick<
  Session,
  | "id"
  | "title"
  | "status"
  | "repoPath"
  | "branch"
  | "projectId"
  | "lastActivityAt"
  | "createdAt"
>;

const statusDot: Record<string, string> = {
  running: "bg-success",
  completed: "bg-accent",
  failed: "bg-danger",
  archived: "bg-text-tertiary",
};

function formatRelativeTime(date: Date | null): string {
  if (!date) return "";
  const diff = Date.now() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

interface SessionCardProps {
  session: SessionCardSession;
  onArchive?: (id: string) => void;
}

export function SessionCard({ session, onArchive }: SessionCardProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleArchive(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setError(null);
    startTransition(async () => {
      const result = await archiveSessionAction(session.id);
      if (result.error) {
        setError(result.error);
      } else {
        onArchive?.(session.id);
      }
    });
  }

  return (
    <Link
      href={`/sessions/${session.id}`}
      className={`group content-auto flex items-center gap-3 px-(--of-space-md) py-(--of-space-sm) transition-colors duration-(--of-duration-instant) hover:bg-surface-1 ${isPending ? "opacity-40 pointer-events-none" : ""}`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot[session.status] ?? "bg-text-tertiary"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-text-primary">
          {session.title}
        </p>
        <p className="truncate text-[11px] font-mono text-text-tertiary">
          {session.repoPath ?? "scratch"}
          {error && <span className="ml-2 text-danger">{error}</span>}
        </p>
      </div>
      <span
        className="shrink-0 text-[11px] tabular-nums text-text-tertiary"
        suppressHydrationWarning
      >
        {formatRelativeTime(session.lastActivityAt ?? session.createdAt)}
      </span>
      <button
        type="button"
        onClick={handleArchive}
        title="Archive session"
        className="shrink-0 p-1 text-text-tertiary opacity-0 transition-opacity duration-(--of-duration-instant) hover:text-text-secondary group-hover:opacity-100"
      >
        <Archive className="h-3.5 w-3.5" />
      </button>
    </Link>
  );
}

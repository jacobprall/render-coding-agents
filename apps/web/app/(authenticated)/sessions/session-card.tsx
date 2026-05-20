"use client";

import Link from "next/link";
import type { Session } from "@coding-agents/db/schema";

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
  idle: "bg-text-tertiary",
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

export function SessionCard({ session }: { session: SessionCardSession }) {
  return (
    <Link
      href={`/sessions/${session.id}`}
      className="content-auto flex items-center gap-3 px-(--of-space-md) py-(--of-space-sm) transition-colors duration-(--of-duration-instant) hover:bg-surface-1"
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
        </p>
      </div>
      <span
        className="shrink-0 text-[11px] tabular-nums text-text-tertiary"
        suppressHydrationWarning
      >
        {formatRelativeTime(session.lastActivityAt ?? session.createdAt)}
      </span>
    </Link>
  );
}

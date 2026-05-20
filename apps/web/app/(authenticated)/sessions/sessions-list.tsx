"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, MessageCircle, Filter } from "lucide-react";
import { Select } from "@/components/primitives/select";
import type { SessionCardSession } from "./session-card";
import { SessionCard } from "./session-card";

interface SessionsListProps {
  sessions: SessionCardSession[];
  projectNames: Record<string, string>;
  initialProjectFilter?: string;
  initialStatusFilter?: string;
}

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "idle", label: "Idle" },
];

export function SessionsList({
  sessions,
  projectNames,
  initialProjectFilter,
  initialStatusFilter,
}: SessionsListProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [projectFilter, setProjectFilter] = useState(initialProjectFilter ?? "");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter ?? "");

  const projectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sessions) {
      if (s.projectId) ids.add(s.projectId);
    }
    return Array.from(ids);
  }, [sessions]);

  const filtered = useMemo(() => {
    let result = sessions;
    if (projectFilter) {
      result = result.filter((s) => s.projectId === projectFilter);
    }
    if (statusFilter) {
      result = result.filter((s) => s.status === statusFilter);
    }
    return result;
  }, [sessions, projectFilter, statusFilter]);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/sessions?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {projectIds.length > 0 && (
            <Select
              size="sm"
              value={projectFilter}
              onChange={(v) => {
                setProjectFilter(v);
                updateFilter("project", v);
              }}
              placeholder="All projects"
              icon={<Filter className="h-3 w-3" />}
              options={projectIds.map((pid) => ({
                value: pid,
                label: projectNames[pid] ?? pid.slice(0, 8),
              }))}
            />
          )}
          <Select
            size="sm"
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v);
              updateFilter("status", v);
            }}
            placeholder="All statuses"
            options={STATUS_OPTIONS.filter((o) => o.value !== "").map((o) => ({
              value: o.value,
              label: o.label,
            }))}
          />
        </div>
        <Link
          href="/sessions/new"
          className="flex items-center gap-1.5 bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-(--of-duration-instant) hover:bg-primary/70"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </Link>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <MessageCircle className="mb-3 h-10 w-10 text-text-tertiary" />
          {sessions.length === 0 ? (
            <>
              <p className="text-text-secondary">No sessions yet</p>
              <p className="mt-1 text-sm text-text-tertiary">
                Start a new session to begin chatting with the agent.
              </p>
            </>
          ) : (
            <p className="text-text-secondary">No sessions match these filters</p>
          )}
        </div>
      ) : (
        <div className="divide-y divide-stroke-subtle border border-stroke-subtle bg-surface-0">
          {filtered.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

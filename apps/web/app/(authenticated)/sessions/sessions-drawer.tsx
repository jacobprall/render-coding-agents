"use client";

import { useState, useMemo } from "react";
import { PanelRightOpen, PanelRightClose, Filter } from "lucide-react";
import { Select } from "@/components/primitives/select";
import type { SessionCardSession } from "./session-card";
import { SessionCard } from "./session-card";

interface SessionsDrawerProps {
  sessions: SessionCardSession[];
  projectNames?: Record<string, string>;
  projectFilter?: string | null;
}

export function SessionsDrawer({ sessions, projectNames, projectFilter }: SessionsDrawerProps) {
  const [open, setOpen] = useState(false);
  const [filterProject, setFilterProject] = useState<string | null>(projectFilter ?? null);

  const projectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sessions) {
      if (s.projectId) ids.add(s.projectId);
    }
    return Array.from(ids);
  }, [sessions]);

  const filtered = useMemo(() => {
    if (!filterProject) return sessions;
    return sessions.filter((s) => s.projectId === filterProject);
  }, [sessions, filterProject]);

  if (sessions.length === 0) return null;

  if (!open) {
    return (
      <div className="shrink-0 border-l border-stroke-subtle">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-3 py-2 text-[13px] font-medium text-text-secondary transition-colors duration-(--of-duration-instant) hover:bg-surface-2 hover:text-text-primary"
          title="Recent sessions"
        >
          <PanelRightOpen className="h-4 w-4" />
          <span className="tabular-nums">{sessions.length}</span>
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Backdrop on mobile */}
      <div
        className="fixed inset-0 z-30 bg-black/50 md:hidden"
        onClick={() => setOpen(false)}
      />

      {/* Panel: overlay on mobile, inline on desktop */}
      <div className="fixed inset-y-0 right-0 z-40 flex h-full w-80 max-w-[85vw] flex-col border-l border-stroke-subtle bg-surface-0 md:static md:z-auto md:max-w-none md:shrink-0">
        <div className="shrink-0 border-b border-stroke-subtle px-(--of-space-md) py-(--of-space-sm)">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center p-1 text-text-tertiary transition-colors duration-(--of-duration-instant) hover:text-text-primary"
              title="Close sessions"
            >
              <PanelRightClose className="h-4 w-4" />
            </button>
            <h2 className="flex-1 font-mono text-[10px] font-medium uppercase tracking-widest text-text-tertiary">
              Recent
            </h2>
            {projectIds.length > 1 && (
              <Select
                size="sm"
                value={filterProject ?? ""}
                onChange={(v) => setFilterProject(v || null)}
                placeholder="All projects"
                icon={<Filter className="h-3 w-3" />}
                options={projectIds.map((pid) => ({
                  value: pid,
                  label: projectNames?.[pid] ?? pid.slice(0, 8),
                }))}
              />
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
          {filtered.length === 0 && (
            <p className="px-(--of-space-md) py-(--of-space-sm) text-[13px] text-text-tertiary">
              No sessions match this filter
            </p>
          )}
        </div>
      </div>
    </>
  );
}

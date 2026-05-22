"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Plus, Archive, Search } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

interface Session {
  id: string;
  title?: string;
  repoPath?: string;
  status: string;
  updatedAt: string;
}

interface GroupedSessions {
  groups: { label: string; sessions: Session[] }[];
}

function fetcher(url: string) {
  return apiFetch<GroupedSessions>(url).then((r) => r.data);
}

interface MobileSessionsViewProps {
  onClose?: () => void;
}

export function MobileSessionsView({ onClose }: MobileSessionsViewProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useSWR(
    `/api/sessions?limit=50&grouped=true&filter=${filter}`,
    fetcher,
    { revalidateOnFocus: true },
  );

  function handleSelect(id: string) {
    router.push(`/sessions/${id}`);
    onClose?.();
  }

  function handleNewSession() {
    router.push("/sessions");
    onClose?.();
  }

  const groups = data?.groups ?? [];
  const filteredGroups = search
    ? groups
        .map((g) => ({
          ...g,
          sessions: g.sessions.filter((s) =>
            (s.title ?? "Untitled").toLowerCase().includes(search.toLowerCase()),
          ),
        }))
        .filter((g) => g.sessions.length > 0)
    : groups;

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sessions…"
            className="h-8 w-full bg-surface-1 pl-8 pr-3 text-sm text-foreground placeholder-muted-foreground outline-none border border-border focus:border-primary/40"
          />
        </div>
        <button
          type="button"
          onClick={() => setFilter(filter === "active" ? "archived" : "active")}
          className={cn(
            "flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors",
            filter === "archived" && "text-primary",
          )}
          aria-label="Toggle archived"
        >
          <Archive className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-14 animate-pulse bg-surface-1" />
            ))}
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
            <p className="text-sm">No sessions found</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredGroups.map((group) => (
              <div key={group.label}>
                <p className="sticky top-0 bg-background/90 backdrop-blur-sm px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                {group.sessions.map((session) => (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleSelect(session.id)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors active:bg-surface-1"
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        session.status === "running"
                          ? "bg-primary animate-pulse"
                          : session.status === "completed"
                            ? "bg-success"
                            : "bg-muted-foreground/40",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {session.title ?? "Untitled session"}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {new Date(session.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <button
          type="button"
          onClick={handleNewSession}
          className="flex w-full items-center justify-center gap-2 bg-primary py-2.5 text-sm font-medium text-white transition-colors active:bg-primary/80"
        >
          <Plus className="size-4" />
          New Agent
        </button>
      </div>
    </div>
  );
}

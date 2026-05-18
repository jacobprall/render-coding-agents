"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Plus, X, Circle, Pause, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SessionTab {
  id: string;
  title: string;
  status: string;
  repoPath: string | null;
}

const STORAGE_KEY = "openforge-session-tabs";

function getStoredTabs(): SessionTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function storeTabs(tabs: SessionTab[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "running":
      return <Circle className="h-2 w-2 fill-current text-green-500" />;
    case "paused":
      return <Pause className="h-2.5 w-2.5 text-yellow-500" />;
    case "completed":
      return <CheckCircle2 className="h-2.5 w-2.5 text-primary" />;
    case "failed":
      return <AlertCircle className="h-2.5 w-2.5 text-destructive" />;
    default:
      return <Circle className="h-2 w-2 text-muted-foreground" />;
  }
}

export function SessionTabs() {
  const [tabs, setTabs] = useState<SessionTab[]>([]);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    setTabs(getStoredTabs());
  }, []);

  useEffect(() => {
    if (tabs.length > 0) {
      storeTabs(tabs);
    }
  }, [tabs]);

  const activeSessionId = pathname.startsWith("/sessions/")
    ? pathname.split("/")[2]
    : null;

  const addTab = useCallback((session: SessionTab) => {
    setTabs((prev) => {
      if (prev.find((t) => t.id === session.id)) return prev;
      return [...prev, session];
    });
  }, []);

  const removeTab = useCallback((id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      storeTabs(next);
      if (id === activeSessionId && next.length > 0) {
        router.push(`/sessions/${next[next.length - 1].id}`);
      } else if (next.length === 0) {
        router.push("/sessions");
      }
      return next;
    });
  }, [activeSessionId, router]);

  const updateTab = useCallback((id: string, updates: Partial<SessionTab>) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  // Expose methods globally for session workspace to call
  useEffect(() => {
    (window as unknown as Record<string, unknown>).__sessionTabs = { addTab, updateTab };
    return () => {
      delete (window as unknown as Record<string, unknown>).__sessionTabs;
    };
  }, [addTab, updateTab]);

  if (!pathname.startsWith("/sessions")) return null;

  return (
    <div className="flex h-9 shrink-0 items-end border-b border-border bg-card/50">
      <div className="flex flex-1 items-end gap-0 overflow-x-auto px-1">
        {tabs.map((tab) => {
          const isActive = tab.id === activeSessionId;
          return (
            <Link
              key={tab.id}
              href={`/sessions/${tab.id}`}
              className={cn(
                "group relative flex h-8 max-w-[200px] items-center gap-2 border-x border-t px-3 text-[12px] transition-colors",
                isActive
                  ? "border-border bg-background text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
            >
              <StatusIcon status={tab.status} />
              <span className="flex-1 truncate">{tab.title || "New session"}</span>
              <button
                onClick={(e) => removeTab(tab.id, e)}
                className="ml-1 hidden h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground group-hover:flex"
              >
                <X className="h-3 w-3" />
              </button>
            </Link>
          );
        })}
      </div>
      <Link
        href="/sessions/new"
        className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
      >
        <Plus className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

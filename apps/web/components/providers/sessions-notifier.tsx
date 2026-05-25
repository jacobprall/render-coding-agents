"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";

interface SessionRow {
  id: string;
  title?: string | null;
  status: string;
  repoPath?: string | null;
  lastActivityAt?: string | null;
}

interface SessionGroup {
  repoPath: string | null;
  label?: string;
  sessions: SessionRow[];
}

interface GroupedSessionsResponse {
  groups: SessionGroup[];
}

const NOTIFIED_KEY = "notify:last-status-by-id";
const POLL_INTERVAL_MS = 30_000;
const PROMPT_DEFER_MS = 30_000;

function readNotified(): Record<string, string> {
  if (typeof sessionStorage === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(NOTIFIED_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeNotified(map: Record<string, string>) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify(map));
  } catch {
    // ignore quota
  }
}

async function fetchActiveSessions(): Promise<SessionRow[]> {
  const res = await fetch("/api/sessions?limit=50&grouped=true&filter=active");
  if (!res.ok) return [];
  const data = (await res.json()) as GroupedSessionsResponse;
  return (data.groups ?? []).flatMap((g) => g.sessions ?? []);
}

/**
 * Background watcher that fires an in-tab browser notification when an
 * agent session transitions from `running` → `completed`/`failed`.
 *
 * Constraints:
 *   - Uses the standard `Notification` API; no backend push / VAPID required.
 *   - Only delivers notifications when the document is hidden, so visible
 *     UI updates aren't duplicated.
 *   - Permission prompt is deferred 30s into the session — never on first
 *     paint — to avoid the dark pattern of asking before showing value.
 *   - Notification click navigates to the session.
 *
 * For higher reliability on iOS / when the tab is closed, a future iteration
 * should pair this with a VAPID-signed Web Push backend.
 */
export function SessionsNotifier() {
  const previousStatusRef = useRef<Record<string, string>>({});

  useEffect(() => {
    previousStatusRef.current = readNotified();
  }, []);

  // Defer the notification permission prompt by a bit, so we ask after the
  // user has seen value.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "default") return;

    const timeout = window.setTimeout(() => {
      // Best effort — user can dismiss permanently, which fine for our flow.
      Notification.requestPermission().catch(() => undefined);
    }, PROMPT_DEFER_MS);

    return () => window.clearTimeout(timeout);
  }, []);

  const { data: sessions } = useSWR<SessionRow[]>(
    "/api/sessions?notifier",
    fetchActiveSessions,
    {
      refreshInterval: POLL_INTERVAL_MS,
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    },
  );

  useEffect(() => {
    if (!sessions || typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") {
      // Still track previous status so we don't backfill notifications later.
      const next: Record<string, string> = {};
      for (const s of sessions) next[s.id] = s.status;
      previousStatusRef.current = next;
      writeNotified(next);
      return;
    }

    const previous = previousStatusRef.current;
    const next: Record<string, string> = {};
    const isHidden = typeof document !== "undefined" && document.hidden;

    for (const s of sessions) {
      next[s.id] = s.status;
      const prevStatus = previous[s.id];
      if (prevStatus !== "running") continue;
      if (s.status !== "completed" && s.status !== "failed") continue;
      // Only notify on background tab — visible UI handles foreground.
      if (!isHidden) continue;

      try {
        const title = s.status === "completed" ? "Agent finished" : "Agent failed";
        const body = s.title?.trim() || s.repoPath?.trim() || "Untitled session";
        const notification = new Notification(title, {
          body,
          tag: `session:${s.id}`,
          icon: "/icons/icon-192.svg",
          data: { url: `/sessions/${s.id}` },
          renotify: false,
        });
        notification.onclick = () => {
          try {
            window.focus();
            window.location.href = `/sessions/${s.id}`;
          } finally {
            notification.close();
          }
        };
      } catch {
        // Notification constructor can throw on some platforms (e.g. iOS Safari).
      }
    }

    previousStatusRef.current = next;
    writeNotified(next);
  }, [sessions]);

  return null;
}

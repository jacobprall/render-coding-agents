"use client";

import { useMemo, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Send, GitBranch, MessageCircle, Filter } from "lucide-react";
import { ChatPanel } from "@/components/session/chat-panel";
import type { Message } from "@/components/session/use-agent-chat";
import { RepoBranchPicker } from "@/components/session/repo-branch-picker";
import { ModelSelector } from "@/components/model-selector";
import { DEFAULT_MODEL_ID } from "@/lib/model-defaults";
import { apiFetch } from "@/lib/api-fetch";
import { Select } from "@/components/primitives/select";
import type { SessionCardSession } from "./session-card";
import { SessionCard } from "./session-card";
import type { SessionTab } from "@/components/layout/session-tabs";

interface SessionsHomeProps {
  sessions: SessionCardSession[];
  projectNames: Record<string, string>;
  initialProjectFilter?: string;
  initialStatusFilter?: string;
  defaultModelId?: string;
  defaultRepo?: string;
  defaultBranch?: string;
  initialRepos?: Array<{
    id: number | string;
    name: string;
    fullName: string;
    defaultBranch: string;
    isPrivate?: boolean;
  }>;
  hasForgeToken?: boolean;
}

interface CreatedSession {
  id: string;
  activeRunId: string | undefined;
  initialMessages: Message[];
  repoPath: string | null;
  branch: string | null;
}

const STATUS_OPTIONS = [
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "archived", label: "Archived" },
];

export function SessionsHome({
  sessions,
  projectNames,
  initialProjectFilter,
  initialStatusFilter,
  defaultModelId,
  defaultRepo,
  defaultBranch,
  initialRepos,
  hasForgeToken = true,
}: SessionsHomeProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [projectFilter, setProjectFilter] = useState(initialProjectFilter ?? "");
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter ?? "");

  const [archivedIds, setArchivedIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [repoBranch, setRepoBranch] = useState<{ repo: string; branch: string } | null>(
    defaultRepo ? { repo: defaultRepo, branch: defaultBranch ?? "main" } : null,
  );
  const [modelId, setModelId] = useState(defaultModelId || DEFAULT_MODEL_ID);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [activeSession, setActiveSession] = useState<CreatedSession | null>(null);

  const projectIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sessions) {
      if (s.projectId) ids.add(s.projectId);
    }
    return Array.from(ids);
  }, [sessions]);

  const filtered = useMemo(() => {
    let result = sessions.filter((s) => !archivedIds.has(s.id));
    if (projectFilter) {
      result = result.filter((s) => s.projectId === projectFilter);
    }
    if (statusFilter) {
      result = result.filter((s) => s.status === statusFilter);
    }
    return result;
  }, [sessions, archivedIds, projectFilter, statusFilter]);

  const handleArchive = useCallback((id: string) => {
    setArchivedIds((prev) => new Set(prev).add(id));
  }, []);

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`/sessions?${params.toString()}`, { scroll: false });
  }

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || creating) return;

    setInput("");
    setCreateError(null);
    setCreating(true);

    try {
      const body: Record<string, string> = { firstMessage: text, modelId };
      if (repoBranch) {
        body.repoPath = repoBranch.repo;
        body.baseBranch = repoBranch.branch;
      }

      const { ok, status, data } = await apiFetch<{
        id: string;
        activeRunId?: string;
        error?: string;
      }>("/api/sessions", { method: "POST", body });

      if (!ok) {
        const msg =
          typeof data.error === "string"
            ? data.error
            : `Failed to create session (${status})`;
        throw new Error(msg);
      }

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
        createdAt: new Date().toISOString(),
      };

      setActiveSession({
        id: data.id,
        activeRunId: data.activeRunId ?? undefined,
        initialMessages: [userMessage],
        repoPath: repoBranch?.repo ?? null,
        branch: repoBranch?.branch ?? null,
      });

      router.replace(`/sessions/${data.id}`);

      const tabs = (window as unknown as Record<string, { addTab?: (t: SessionTab) => void }>).__sessionTabs;
      if (tabs?.addTab) {
        tabs.addTab({
          id: data.id,
          title: text.slice(0, 50),
          status: "running",
          repoPath: repoBranch?.repo ?? null,
        });
      }

      apiFetch<{ ok?: boolean; title?: string }>(
        `/api/sessions/${data.id}/auto-title`,
        { method: "POST" },
      ).then(({ ok: titleOk, data: titleData }) => {
        if (titleOk && titleData.title) {
          document.title = `${titleData.title} | Coding Agents`;
        }
      }).catch(() => {});
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCreating(false);
    }
  }, [input, creating, modelId, repoBranch, router]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (activeSession) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <div className="shrink-0 flex items-center gap-3 border-b border-stroke-subtle px-4 py-2">
          {activeSession.repoPath ? (
            <span className="flex items-center gap-1.5 text-[12px] font-mono text-text-tertiary">
              <GitBranch className="h-3 w-3" />
              {activeSession.repoPath}
              {activeSession.branch && (
                <span className="text-text-tertiary/60"> : {activeSession.branch}</span>
              )}
            </span>
          ) : (
            <span className="text-[12px] text-text-tertiary">scratch</span>
          )}
          <div className="ml-auto">
            <ModelSelector value={modelId} onChange={setModelId} compact />
          </div>
        </div>
        <div className="flex-1 overflow-hidden">
          <ChatPanel
            sessionId={activeSession.id}
            activeRunId={activeSession.activeRunId ?? null}
            initialMessages={activeSession.initialMessages}
            modelId={modelId}
            autoStream
            autoStreamRunId={activeSession.activeRunId}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Session list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-(--of-space-md) py-(--of-space-lg)">
        <div className="mx-auto max-w-4xl">
          {sessions.length > 0 && (
            <>
              <div className="mb-3 flex items-center gap-2">
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
                  options={STATUS_OPTIONS}
                />
              </div>

              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <MessageCircle className="mb-3 h-8 w-8 text-text-tertiary" />
                  <p className="text-text-secondary text-sm">No sessions match these filters</p>
                </div>
              ) : (
                <div className="divide-y divide-stroke-subtle border border-stroke-subtle bg-surface-0">
                  {filtered.map((s) => (
                    <SessionCard key={s.id} session={s} onArchive={handleArchive} />
                  ))}
                </div>
              )}
            </>
          )}

          {sessions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <MessageCircle className="mb-3 h-10 w-10 text-text-tertiary" />
              <p className="text-text-secondary">No sessions yet</p>
              <p className="mt-1 text-sm text-text-tertiary">
                Describe what you want to build below to start your first session.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Chat input */}
      <div className="shrink-0 border-t border-stroke-subtle px-(--of-space-md) py-(--of-space-md)">
        <div className="mx-auto max-w-4xl">
          {!hasForgeToken && (
            <div className="mb-3 flex items-center justify-between border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <p className="text-sm text-amber-200">
                Connect your GitHub account to access repositories.
              </p>
              <Link
                href="/settings/connections"
                className="shrink-0 bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary/60"
              >
                Connect GitHub
              </Link>
            </div>
          )}
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <RepoBranchPicker
              value={repoBranch}
              onChange={setRepoBranch}
              initialRepos={initialRepos}
            />
            <ModelSelector value={modelId} onChange={setModelId} compact dropUp />
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            <div className="flex items-end gap-2 border border-stroke-default bg-surface-1 p-2 transition-colors duration-(--of-duration-instant) focus-within:border-accent/50 focus-within:ring-1 focus-within:ring-accent/25">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you want to build…"
                rows={3}
                className="max-h-36 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-text-primary placeholder-text-tertiary outline-none"
                disabled={creating}
              />
              <button
                type="submit"
                disabled={!input.trim() || creating}
                className="flex items-center gap-1.5 bg-primary px-3 py-1.5 text-sm font-medium text-white transition-colors duration-(--of-duration-instant) hover:bg-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <span className="inline-flex animate-spin">
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </span>
                    Starting…
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    Start
                  </>
                )}
              </button>
            </div>
          </form>
          {createError && (
            <p className="mt-2 text-[13px] text-danger">{createError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Send, GitBranch, MessageCircle } from "lucide-react";
import { ChatPanel } from "@/components/session/chat-panel";
import type { Message } from "@/components/session/use-agent-chat";
import { RepoBranchPicker } from "@/components/session/repo-branch-picker";
import { ModelSelector } from "@/components/model-selector";
import { DEFAULT_MODEL_ID } from "@/lib/model-defaults";
import { apiFetch } from "@/lib/api-fetch";
import type { SessionTab } from "@/components/layout/session-tabs";

interface RecentSession {
  id: string;
  title: string | null;
  status: string;
  repoPath: string | null;
  createdAt: Date | null;
}

interface NewChatViewProps {
  defaultModelId?: string;
  defaultRepo?: string;
  defaultBranch?: string;
  projectId?: string;
  recentSessions?: RecentSession[];
  initialRepos?: Array<{
    id: number | string;
    name: string;
    fullName: string;
    defaultBranch: string;
    isPrivate?: boolean;
  }>;
}

interface CreatedSession {
  id: string;
  activeRunId: string | undefined;
  initialMessages: Message[];
  repoPath: string | null;
  branch: string | null;
}

export function NewChatView({
  defaultModelId,
  defaultRepo,
  defaultBranch,
  projectId,
  recentSessions = [],
  initialRepos,
}: NewChatViewProps) {
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [repoBranch, setRepoBranch] = useState<{
    repo: string;
    branch: string;
  } | null>(
    defaultRepo
      ? { repo: defaultRepo, branch: defaultBranch ?? "main" }
      : null,
  );
  const [modelId, setModelId] = useState(defaultModelId || DEFAULT_MODEL_ID);
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [session, setSession] = useState<CreatedSession | null>(null);

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
      if (projectId) body.projectId = projectId;

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

      setSession({
        id: data.id,
        activeRunId: data.activeRunId ?? undefined,
        initialMessages: [userMessage],
        repoPath: repoBranch?.repo ?? null,
        branch: repoBranch?.branch ?? null,
      });

      window.history.replaceState(null, "", `/sessions/${data.id}`);

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
          document.title = `${titleData.title} | OpenForge`;
        }
      }).catch(() => {});
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setCreating(false);
    }
  }, [input, creating, modelId, repoBranch, projectId]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (session) {
    return (
      <div className="absolute inset-0 flex flex-col">
        <div className="shrink-0 flex items-center gap-3 border-b border-stroke-subtle px-4 py-2">
          {session.repoPath ? (
            <span className="flex items-center gap-1.5 text-[12px] font-mono text-text-tertiary">
              <GitBranch className="h-3 w-3" />
              {session.repoPath}
              {session.branch && (
                <span className="text-text-tertiary/60">
                  {" "}
                  : {session.branch}
                </span>
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
            sessionId={session.id}
            activeRunId={session.activeRunId ?? null}
            initialMessages={session.initialMessages}
            modelId={modelId}
            autoStream
            autoStreamRunId={session.activeRunId}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-(--of-space-md) py-(--of-space-xl)">
        {recentSessions.length > 0 ? (
          <div className="mx-auto flex max-w-4xl flex-1 flex-col items-center justify-end pb-4">
            <h3 className="mb-2 self-start text-[12px] font-semibold uppercase tracking-wider text-text-tertiary">
              Recent sessions
            </h3>
            <div className="w-full divide-y divide-stroke-subtle border border-stroke-subtle bg-surface-0">
              {recentSessions.map((s) => (
                <Link
                  key={s.id}
                  href={`/sessions/${s.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 transition-colors duration-(--of-duration-instant) hover:bg-surface-1"
                >
                  <MessageCircle className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">
                    {s.title || "Untitled session"}
                  </span>
                  <span className="shrink-0 text-[11px] font-mono text-text-tertiary">
                    {s.repoPath ?? "scratch"}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 border-t border-stroke-subtle px-(--of-space-md) py-(--of-space-md)">
        <div className="mx-auto max-w-4xl">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <RepoBranchPicker
              value={repoBranch}
              onChange={setRepoBranch}
              initialRepos={initialRepos}
            />
            <ModelSelector
              value={modelId}
              onChange={setModelId}
              compact
              dropUp
            />
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
                className="flex items-center gap-1.5 bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors duration-(--of-duration-instant) hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                {creating ? (
                  <>
                    <span className="inline-flex animate-spin">
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
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

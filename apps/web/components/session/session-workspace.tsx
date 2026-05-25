"use client";

import { useState, useCallback, useEffect, useRef, startTransition } from "react";
import dynamic from "next/dynamic";
import type { AssistantPart } from "@/lib/ui";
import { DEFAULT_MODEL_ID } from "@/lib/model-defaults";
import { PrSummaryPanel } from "./pr-summary-panel";
import { ReviewBar } from "./review-bar";
import type { Message, LiveFileChange } from "./chat-panel";
import type { SessionTab } from "@/components/layout/session-tabs";
import { notifyGitStatusRefresh } from "@/hooks/use-git-status";
import { apiFetch } from "@/lib/api-fetch";

function modelStorageKey(sessionId: string) {
  return `model:${sessionId}`;
}

function readStoredModelId(sessionId: string): string | null {
  try {
    return localStorage.getItem(modelStorageKey(sessionId));
  } catch {
    return null;
  }
}

const ChatPanel = dynamic(
  () => import("./chat-panel").then((m) => ({ default: m.ChatPanel })),
  {
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-text-tertiary">Loading chat…</div>
    ),
  },
);

const FilesView = dynamic(
  () => import("./files-view").then((m) => ({ default: m.FilesView })),
  {
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-text-tertiary">Loading files…</div>
    ),
  },
);

type ViewTab = "chat" | "files";

interface SessionInfo {
  id: string;
  title: string;
  repoPath: string | null;
  branch: string | null;
  activeSkills: Array<{ source: string; slug: string }>;
  status: string;
  prNumber: number | null;
  prStatus: string | null;
  upstreamPrUrl: string | null;
  linesAdded: number | null;
  linesRemoved: number | null;
}

interface SessionWorkspaceProps {
  session: SessionInfo;
  initialModelId?: string | null;
  activeRunId: string | null;
  terminalReason?: string | null;
  terminalStatus?: string | null;
  initialMessages: {
    id: string;
    role: "user" | "assistant";
    parts: AssistantPart[];
    createdAt: string;
  }[];
}

export function SessionWorkspace({
  session,
  initialModelId,
  activeRunId,
  terminalReason,
  initialMessages,
}: SessionWorkspaceProps) {
  const [activeView, setActiveView] = useState<ViewTab>("chat");
  const [filesSubView, setFilesSubView] = useState<"tree" | "changes">("tree");
  const [title, setTitle] = useState(session.title);
  const [modelId, setModelId] = useState(() => {
    const id = initialModelId?.trim();
    return id && id.length > 0 ? id : DEFAULT_MODEL_ID;
  });
  const [liveFileChanges, setLiveFileChanges] = useState<LiveFileChange[]>([]);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitToast, setCommitToast] = useState<string | null>(null);
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const clearChatFileChangesRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const stored = readStoredModelId(session.id);
    if (stored) {
      setModelId(stored);
    }
  }, [session.id]);

  useEffect(() => {
    try {
      localStorage.setItem(modelStorageKey(session.id), modelId);
    } catch {
      // ignore quota / private browsing
    }
  }, [session.id, modelId]);

  useEffect(() => {
    const tabs = (window as unknown as Record<string, { addTab?: (t: SessionTab) => void; updateTab?: (id: string, u: Partial<SessionTab>) => void }>).__sessionTabs;
    if (tabs?.addTab) {
      tabs.addTab({
        id: session.id,
        title: session.title,
        status: session.status,
        repoPath: session.repoPath,
      });
    }
  }, [session.id, session.title, session.status, session.repoPath]);

  const handleFileChanges = useCallback((files: LiveFileChange[]) => {
    setLiveFileChanges(files);
  }, []);

  const handleTitleChange = useCallback((newTitle: string) => {
    setTitle(newTitle);
    document.title = `${newTitle} | Coding Agents`;
    const tabs = (window as unknown as Record<string, { updateTab?: (id: string, u: Partial<SessionTab>) => void }>).__sessionTabs;
    if (tabs?.updateTab) {
      tabs.updateTab(session.id, { title: newTitle });
    }
  }, [session.id]);

  const handleViewFiles = useCallback(() => {
    setFilesSubView("tree");
    startTransition(() => setActiveView("files"));
  }, []);

  const handleFileSelect = useCallback((path: string) => {
    setPendingFilePath(path);
    setFilesSubView("tree");
    startTransition(() => setActiveView("files"));
  }, []);

  const handleReviewClick = useCallback(() => {
    setPendingFilePath(null);
    setFilesSubView("changes");
    startTransition(() => setActiveView("files"));
  }, []);

  const handleCommit = useCallback(async () => {
    if (isCommitting || liveFileChanges.length === 0) return;
    setIsCommitting(true);
    setCommitToast(null);
    try {
      const fileList = liveFileChanges.map((f) => f.path).join(", ");
      const res = await apiFetch<{
        error?: string;
        commitSha?: string;
        branch?: string;
        pushed?: boolean;
        pushError?: string;
      }>(`/api/sessions/${session.id}/git/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Agent changes: ${fileList}`,
          createBranch: true,
        }),
      });
      if (!res.ok) {
        const err =
          typeof res.data.error === "string"
            ? res.data.error
            : "Failed to commit changes";
        throw new Error(err);
      }
      setLiveFileChanges([]);
      clearChatFileChangesRef.current?.();
      notifyGitStatusRefresh();

      const { commitSha, branch, pushed, pushError } = res.data;
      let toast = `Committed ${commitSha ?? ""} on ${branch ?? "branch"}`;
      if (pushed) {
        toast = `Committed and pushed ${commitSha ?? ""} on ${branch ?? "branch"}`;
      } else if (pushError) {
        toast = `Committed locally (${commitSha}); push failed: ${pushError}`;
      }
      setCommitToast(toast);
      setTimeout(() => setCommitToast(null), 5000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to commit changes";
      setCommitToast(msg);
      setTimeout(() => setCommitToast(null), 5000);
    } finally {
      setIsCommitting(false);
    }
  }, [isCommitting, liveFileChanges, session.id]);

  const reviewFileChanges = liveFileChanges.map((f) => ({
    path: f.path,
    linesAdded: f.additions,
    linesRemoved: f.deletions,
    unifiedDiffPreview: f.unifiedDiffPreview,
  }));

  const fileCount = liveFileChanges.length;

  return (
    <div className="absolute inset-0 flex flex-col">
      <header className="shrink-0 border-b border-stroke-subtle">
        <div className="flex items-center gap-0.5 px-4">
          <TabButton
            active={activeView === "chat"}
            onClick={() => startTransition(() => setActiveView("chat"))}
          >
            Chat
          </TabButton>
          <TabButton
            active={activeView === "files"}
            onClick={() => {
              setPendingFilePath(null);
              startTransition(() => setActiveView("files"));
            }}
            badge={fileCount > 0 ? fileCount : undefined}
          >
            Files
          </TabButton>
        </div>
      </header>

      {session.prNumber != null && session.repoPath && (
        <div className="shrink-0 border-b border-stroke-subtle px-4 py-2">
          <PrSummaryPanel
            sessionId={session.id}
            repoPath={session.repoPath}
            prNumber={session.prNumber}
            prStatus={session.prStatus ?? null}
            branch={session.branch}
            upstreamPrUrl={session.upstreamPrUrl}
          />
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <div className={activeView === "chat" ? "h-full" : "hidden"}>
          <ChatPanel
            sessionId={session.id}
            activeRunId={activeRunId}
            initialMessages={initialMessages as Message[]}
            initialTerminalReason={terminalReason}
            modelId={modelId}
            activeSkills={session.activeSkills}
            onModelChange={setModelId}
            onFileChanges={handleFileChanges}
            onViewFiles={handleViewFiles}
            onFileSelect={handleFileSelect}
            onTitleChange={handleTitleChange}
            autoStream={activeRunId != null && session.status === "running"}
            autoStreamRunId={activeRunId ?? undefined}
            onRegisterClearFileChanges={(clear) => {
              clearChatFileChangesRef.current = clear;
            }}
            aboveInput={
              liveFileChanges.length > 0 || commitToast ? (
                <>
                  {liveFileChanges.length > 0 ? (
                    <ReviewBar
                      fileChanges={reviewFileChanges}
                      sessionId={session.id}
                      onCommit={() => void handleCommit()}
                      onReviewClick={handleReviewClick}
                      isCommitting={isCommitting}
                      commitMessage={commitToast ?? undefined}
                    />
                  ) : commitToast ? (
                    <div className="shrink-0 border-t border-stroke-subtle px-(--of-space-md) py-2 text-center text-[11px] text-accent-text">
                      {commitToast}
                    </div>
                  ) : null}
                </>
              ) : undefined
            }
          />
        </div>
        <div className={activeView === "files" ? "h-full" : "hidden"}>
          <FilesView
            sessionId={session.id}
            fileChanges={liveFileChanges}
            initialFilePath={pendingFilePath}
            initialSubView={filesSubView}
          />
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-[44px] items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors duration-(--of-duration-instant) ${
        active
          ? "border-b-2 border-accent text-text-primary"
          : "border-b-2 border-transparent text-text-tertiary hover:text-text-secondary"
      }`}
    >
      {children}
      {badge !== undefined ? (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-surface-3 px-1 text-[10px] tabular-nums text-text-secondary">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

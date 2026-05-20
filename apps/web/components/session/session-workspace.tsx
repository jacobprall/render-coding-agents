"use client";

import { useState, useCallback, useEffect, startTransition } from "react";
import dynamic from "next/dynamic";
import type { AssistantPart } from "@/lib/ui";
import { ModelSelector } from "@/components/model-selector";
import { DEFAULT_MODEL_ID } from "@/lib/model-defaults";
import { PrSummaryPanel } from "./pr-summary-panel";
import type { Message, LiveFileChange } from "./chat-panel";
import type { SessionTab } from "@/components/layout/session-tabs";

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
  initialMessages: {
    id: string;
    role: "user" | "assistant";
    parts: AssistantPart[];
    createdAt: string;
  }[];
}

const statusDot: Record<string, string> = {
  running: "bg-accent",
  completed: "bg-blue-500",
  failed: "bg-red-500",
  archived: "bg-text-tertiary",
};

export function SessionWorkspace({
  session,
  initialModelId,
  activeRunId,
  initialMessages,
}: SessionWorkspaceProps) {
  const [activeView, setActiveView] = useState<ViewTab>("chat");
  const [title, setTitle] = useState(session.title);
  const [modelId, setModelId] = useState(() => {
    const id = initialModelId?.trim();
    return id && id.length > 0 ? id : DEFAULT_MODEL_ID;
  });
  const [liveFileChanges, setLiveFileChanges] = useState<LiveFileChange[]>([]);

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
    startTransition(() => setActiveView("files"));
  }, []);

  const fileCount = liveFileChanges.length;
  const hasLineStats =
    session.linesAdded != null || session.linesRemoved != null;

  const headerPrHref =
    session.prNumber != null && session.repoPath
      ? session.upstreamPrUrl?.trim() || `/${session.repoPath}/pulls/${session.prNumber}`
      : null;

  return (
    <div className="absolute inset-0 flex flex-col">
      <header className="shrink-0 border-b border-stroke-subtle">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-2 pb-1">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            {session.repoPath ? (
              <span className="font-mono text-text-tertiary truncate">
                {session.repoPath}
                {session.branch ? (
                  <span className="text-text-tertiary"> : {session.branch}</span>
                ) : null}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5 text-text-tertiary">
              <span className={`h-1.5 w-1.5 rounded-full ${statusDot[session.status] ?? "bg-text-tertiary"}`} />
              {session.status}
            </span>
            {headerPrHref ? (
              <a
                href={headerPrHref}
                {...(headerPrHref.startsWith("http://") || headerPrHref.startsWith("https://")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
                className="text-blue-400 hover:text-blue-300 font-mono"
              >
                PR #{session.prNumber}
              </a>
            ) : null}
            {hasLineStats ? (
              <span className="inline-flex items-center font-mono tabular-nums leading-none">
                <span className="text-accent-text/70">+{session.linesAdded ?? 0}</span>
                <span className="text-text-tertiary mx-0.5">/</span>
                <span className="text-danger/70">&minus;{session.linesRemoved ?? 0}</span>
              </span>
            ) : null}
          </div>
          <div className="shrink-0">
            <ModelSelector value={modelId} onChange={setModelId} compact />
          </div>
        </div>

        <div className="flex items-center gap-0.5 px-4 -mb-px">
          <TabButton
            active={activeView === "chat"}
            onClick={() => startTransition(() => setActiveView("chat"))}
          >
            Chat
          </TabButton>
          <TabButton
            active={activeView === "files"}
            onClick={() => startTransition(() => setActiveView("files"))}
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
            modelId={modelId}
            onFileChanges={handleFileChanges}
            onViewFiles={handleViewFiles}
            onTitleChange={handleTitleChange}
            autoStream={activeRunId != null}
            autoStreamRunId={activeRunId ?? undefined}
          />
        </div>
        <div className={activeView === "files" ? "h-full" : "hidden"}>
          <FilesView
            sessionId={session.id}
            fileChanges={liveFileChanges}
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
      className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors duration-(--of-duration-instant) ${
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

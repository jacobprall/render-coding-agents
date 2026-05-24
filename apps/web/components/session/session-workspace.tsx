"use client";

import { useState, useCallback, useEffect, startTransition } from "react";
import dynamic from "next/dynamic";
import type { AssistantPart } from "@/lib/ui";
import { DEFAULT_MODEL_ID } from "@/lib/model-defaults";
import { PrSummaryPanel } from "./pr-summary-panel";
import type { Message, LiveFileChange } from "./chat-panel";
import type { SessionTab } from "@/components/layout/session-tabs";

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

const GitPanel = dynamic(
  () => import("./git-panel").then((m) => ({ default: m.GitPanel })),
  {
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-text-tertiary">Loading git…</div>
    ),
  },
);

type ViewTab = "chat" | "files" | "git";

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
  const [title, setTitle] = useState(session.title);
  const [modelId, setModelId] = useState(() => {
    const id = initialModelId?.trim();
    return id && id.length > 0 ? id : DEFAULT_MODEL_ID;
  });
  const [liveFileChanges, setLiveFileChanges] = useState<LiveFileChange[]>([]);
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);

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
    startTransition(() => setActiveView("files"));
  }, []);

  const handleFileSelect = useCallback(
    (path: string) => {
      setPendingFilePath(path);
      startTransition(() => setActiveView("files"));
    },
    [],
  );

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
          <TabButton
            active={activeView === "git"}
            onClick={() => startTransition(() => setActiveView("git"))}
          >
            Git
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
            onModelChange={setModelId}
            onFileChanges={handleFileChanges}
            onViewFiles={handleViewFiles}
            onFileSelect={handleFileSelect}
            onTitleChange={handleTitleChange}
            autoStream={activeRunId != null}
            autoStreamRunId={activeRunId ?? undefined}
          />
        </div>
        <div className={activeView === "files" ? "h-full" : "hidden"}>
          <FilesView
            sessionId={session.id}
            fileChanges={liveFileChanges}
            initialFilePath={pendingFilePath}
          />
        </div>
        <div className={activeView === "git" ? "h-full" : "hidden"}>
          <GitPanel
            sessionId={session.id}
            enabled={activeView === "git"}
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

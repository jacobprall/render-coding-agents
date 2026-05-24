"use client";

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentChat } from "./use-agent-chat";
import type { Message, LiveFileChange } from "./use-agent-chat";
import { MessageArea } from "./message-list";
import { ChatInput } from "./chat-input";

export type { Message, LiveFileChange } from "./use-agent-chat";

interface ChatPanelProps {
  sessionId: string;
  activeRunId: string | null;
  initialMessages: Message[];
  modelId: string;
  onModelChange: (modelId: string) => void;
  initialTerminalReason?: string | null;
  onFileChanges?: (files: LiveFileChange[]) => void;
  onViewFiles?: () => void;
  onFileSelect?: (path: string) => void;
  onTitleChange?: (title: string) => void;
  activeSkills?: Array<{ source: string; slug: string }>;
  /** Automatically start streaming when mounted */
  autoStream?: boolean;
  /** Run ID to pass when auto-starting the stream */
  autoStreamRunId?: string;
  /** Optional slot rendered above the chat input */
  aboveInput?: React.ReactNode;
  /** Called when user requests to clear tracked file changes (e.g. after commit) */
  onRegisterClearFileChanges?: (clear: () => void) => void;
}

export function ChatPanel({
  sessionId,
  activeRunId,
  initialMessages,
  modelId,
  onModelChange,
  initialTerminalReason,
  onFileChanges,
  onViewFiles,
  onFileSelect,
  onTitleChange,
  activeSkills = [],
  autoStream,
  autoStreamRunId,
  aboveInput,
  onRegisterClearFileChanges,
}: ChatPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const autoStreamFired = useRef(false);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const chat = useAgentChat({
    sessionId,
    modelId,
    activeRunId,
    initialMessages,
    initialTerminalReason,
    onFileChanges,
    onTitleChange,
  });

  useEffect(() => {
    onRegisterClearFileChanges?.(chat.clearFileChanges);
  }, [chat.clearFileChanges, onRegisterClearFileChanges]);

  useEffect(() => {
    if (!autoStream || !autoStreamRunId || autoStreamFired.current) return;
    autoStreamFired.current = true;
    chat.startStreaming(autoStreamRunId);
  }, [autoStream, autoStreamRunId, chat.startStreaming]);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsAtBottom(entry?.isIntersecting ?? false);
      },
      { root: container, threshold: 0, rootMargin: "0px 0px 80px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isAtBottom) {
      scrollToBottom();
    }
  }, [chat.messages, chat.streamingParts, isAtBottom, scrollToBottom]);

  const isStreaming = chat.status === "streaming" || chat.status === "waitingForRun";

  const pendingAsk = useMemo(() => {
    if (!activeRunId && !isStreaming) return null;
    for (let i = chat.streamingParts.length - 1; i >= 0; i--) {
      const p = chat.streamingParts[i];
      if (p?.type === "ask_user" && p.toolCallId) return p;
    }
    for (let mi = chat.messages.length - 1; mi >= 0; mi--) {
      const m = chat.messages[mi];
      if (m?.role !== "assistant") continue;
      for (let j = m.parts.length - 1; j >= 0; j--) {
        const p = m.parts[j];
        if (p?.type === "ask_user" && p.toolCallId) return p;
      }
    }
    return null;
  }, [activeRunId, isStreaming, chat.streamingParts, chat.messages]);

  function handleAskUserResponse(answer: string) {
    if (chat.askUserPrompt?.toolCallId && (activeRunId || chat.activeRunId)) {
      void chat.submitAskUserReply(answer);
      return;
    }
    void chat.sendMessage(answer);
  }

  const askResolved = chat.askUserPrompt ?? pendingAsk;

  const handleContinue = useCallback(() => {
    void chat.sendMessage("Continue where you left off.");
  }, [chat.sendMessage]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto px-(--of-space-md) py-(--of-space-xl)">
        <div className="mx-auto max-w-4xl flex flex-col gap-(--of-space-lg)">
          <MessageArea
            messages={chat.messages}
            streamingParts={chat.streamingParts}
            isStreaming={isStreaming}
            liveFileChanges={chat.liveFileChanges}
            askResolved={askResolved}
            onAskUserResponse={handleAskUserResponse}
            onViewFiles={onViewFiles}
            onFileSelect={onFileSelect}
            error={chat.error}
            terminalReason={chat.terminalReason}
            stepLimitReached={chat.stepLimitReached}
            onContinue={handleContinue}
          />
          <div ref={scrollSentinelRef} className="h-px w-full shrink-0" aria-hidden />
        </div>
      </div>

      {!isAtBottom ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label="Scroll to latest messages"
          className={cn(
            "absolute bottom-[calc(var(--chat-input-offset,5.5rem))] left-1/2 z-10 -translate-x-1/2",
            "inline-flex items-center gap-1.5 border border-stroke-subtle bg-surface-1 px-3 py-1.5",
            "text-xs font-medium text-text-secondary shadow-md transition-colors hover:bg-surface-2 hover:text-text-primary",
          )}
        >
          <ArrowDown className="size-3.5" />
          Scroll to bottom
        </button>
      ) : null}

      {aboveInput}
      <ChatInput
        isStreaming={isStreaming}
        modelId={modelId}
        activeSkills={activeSkills}
        onModelChange={onModelChange}
        onSend={(content, turnSkillRefs) => void chat.sendMessage(content, turnSkillRefs)}
        onStop={() => void chat.stopStreaming()}
      />
    </div>
  );
}

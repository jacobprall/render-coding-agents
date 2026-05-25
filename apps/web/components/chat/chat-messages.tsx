"use client";

import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MessageArea } from "../session/message-list";
import { useChatContext } from "./chat-context";
import type { ReactNode } from "react";

interface ChatMessagesProps {
  className?: string;
  aboveInput?: ReactNode;
}

function ChatMessages({ className, aboveInput }: ChatMessagesProps) {
  const {
    messages,
    streamingParts,
    isStreaming,
    liveFileChanges,
    askUserPrompt,
    activeRunId,
    error,
    terminalReason,
    stepLimitReached,
    setupPhase,
    sendMessage,
    submitAskUserReply,
    onViewFiles,
    onFileSelect,
  } = useChatContext();

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollSentinelRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

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
      ([entry]) => setIsAtBottom(entry?.isIntersecting ?? false),
      { root: container, threshold: 0, rootMargin: "0px 0px 80px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isAtBottom) scrollToBottom();
  }, [messages, streamingParts, isAtBottom, scrollToBottom]);

  const pendingAsk = useMemo(() => {
    if (!activeRunId && !isStreaming) return null;
    for (let i = streamingParts.length - 1; i >= 0; i--) {
      const p = streamingParts[i];
      if (p?.type === "ask_user" && p.toolCallId) return p;
    }
    for (let mi = messages.length - 1; mi >= 0; mi--) {
      const m = messages[mi];
      if (m?.role !== "assistant") continue;
      for (let j = m.parts.length - 1; j >= 0; j--) {
        const p = m.parts[j];
        if (p?.type === "ask_user" && p.toolCallId) return p;
      }
    }
    return null;
  }, [activeRunId, isStreaming, streamingParts, messages]);

  function handleAskUserResponse(answer: string) {
    if (askUserPrompt?.toolCallId && (activeRunId)) {
      void submitAskUserReply(answer);
      return;
    }
    void sendMessage(answer);
  }

  const askResolved = askUserPrompt ?? pendingAsk;

  const handleContinue = useCallback(() => {
    void sendMessage("Continue where you left off.");
  }, [sendMessage]);

  return (
    <div className={cn("relative flex h-full flex-col overflow-hidden", className)}>
      <div
        ref={scrollContainerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-(--of-space-md) py-(--of-space-xl)"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="mx-auto flex max-w-4xl flex-col gap-(--of-space-lg)">
          <MessageArea
            messages={messages}
            streamingParts={streamingParts}
            isStreaming={isStreaming}
            liveFileChanges={liveFileChanges}
            askResolved={askResolved}
            onAskUserResponse={handleAskUserResponse}
            onViewFiles={onViewFiles}
            onFileSelect={onFileSelect}
            error={error}
            terminalReason={terminalReason}
            stepLimitReached={stepLimitReached}
            onContinue={handleContinue}
            setupPhase={setupPhase}
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
            "absolute bottom-[calc(var(--chat-input-offset,6rem))] left-1/2 z-10 -translate-x-1/2",
            "inline-flex min-h-[40px] items-center gap-1.5 border border-stroke-subtle bg-surface-1 px-3.5 py-2",
            "text-xs font-medium text-text-secondary shadow-md transition-colors hover:bg-surface-2 hover:text-text-primary",
          )}
        >
          <ArrowDown className="size-3.5" />
          Scroll to bottom
        </button>
      ) : null}

      {aboveInput}
    </div>
  );
}
ChatMessages.displayName = "Chat.Messages";

export { ChatMessages };

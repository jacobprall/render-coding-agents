"use client";

import { useRef, useEffect, useCallback, useMemo } from "react";
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
  onFileChanges?: (files: LiveFileChange[]) => void;
  onViewFiles?: () => void;
  onTitleChange?: (title: string) => void;
  /** Automatically start streaming when mounted */
  autoStream?: boolean;
  /** Run ID to pass when auto-starting the stream */
  autoStreamRunId?: string;
  /** Optional slot rendered above the chat input */
  aboveInput?: React.ReactNode;
}

export function ChatPanel({
  sessionId,
  activeRunId,
  initialMessages,
  modelId,
  onFileChanges,
  onViewFiles,
  onTitleChange,
  autoStream,
  autoStreamRunId,
  aboveInput,
}: ChatPanelProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const autoStreamFired = useRef(false);

  const chat = useAgentChat({
    sessionId,
    modelId,
    activeRunId,
    initialMessages,
    onFileChanges,
    onTitleChange,
  });

  useEffect(() => {
    if (autoStream && !autoStreamFired.current) {
      autoStreamFired.current = true;
      chat.startStreaming(autoStreamRunId);
    }
  }, [autoStream, chat.startStreaming, autoStreamRunId]);

  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chat.messages, chat.streamingParts, scrollToBottom]);

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

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
            error={chat.error}
          />
          <div ref={messagesEndRef} />
        </div>
      </div>
      {aboveInput}
      <ChatInput
        isStreaming={isStreaming}
        onSend={(content) => void chat.sendMessage(content)}
        onStop={() => void chat.stopStreaming()}
      />
    </div>
  );
}

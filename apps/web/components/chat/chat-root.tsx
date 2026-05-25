"use client";

import { useMemo, useEffect, useRef, type ReactNode } from "react";
import { useAgentChat } from "../session/use-agent-chat";
import type { Message, LiveFileChange } from "../session/use-agent-chat";
import { ChatContext, type ChatContextValue } from "./chat-context";

interface ChatRootProps {
  children: ReactNode;
  sessionId: string;
  modelId: string;
  onModelChange: (modelId: string) => void;
  activeRunId?: string | null;
  initialMessages?: Message[];
  initialTerminalReason?: string | null;
  activeSkills?: Array<{ source: string; slug: string }>;
  autoStream?: boolean;
  autoStreamRunId?: string;
  onFileChanges?: (files: LiveFileChange[]) => void;
  onTitleChange?: (title: string) => void;
  onViewFiles?: () => void;
  onFileSelect?: (path: string) => void;
  onRegisterClearFileChanges?: (clear: () => void) => void;
}

function ChatRoot({
  children,
  sessionId,
  modelId,
  onModelChange,
  activeRunId,
  initialMessages = [],
  initialTerminalReason,
  activeSkills = [],
  autoStream,
  autoStreamRunId,
  onFileChanges,
  onTitleChange,
  onViewFiles,
  onFileSelect,
  onRegisterClearFileChanges,
}: ChatRootProps) {
  const chat = useAgentChat({
    sessionId,
    modelId,
    activeRunId: activeRunId ?? undefined,
    initialMessages,
    initialTerminalReason: initialTerminalReason ?? undefined,
    onFileChanges,
    onTitleChange,
  });

  const autoStreamFired = useRef(false);
  useEffect(() => {
    if (!autoStream || !autoStreamRunId || autoStreamFired.current) return;
    autoStreamFired.current = true;
    chat.startStreaming(autoStreamRunId);
  }, [autoStream, autoStreamRunId, chat.startStreaming]);

  useEffect(() => {
    onRegisterClearFileChanges?.(chat.clearFileChanges);
  }, [chat.clearFileChanges, onRegisterClearFileChanges]);

  const isStreaming = chat.status === "streaming" || chat.status === "waitingForRun";

  const value = useMemo<ChatContextValue>(
    () => ({
      sessionId,
      messages: chat.messages,
      streamingParts: chat.streamingParts,
      status: chat.status,
      isStreaming,
      error: chat.error,
      liveFileChanges: chat.liveFileChanges,
      askUserPrompt: chat.askUserPrompt,
      activeRunId: chat.activeRunId,
      terminalReason: chat.terminalReason,
      stepLimitReached: chat.stepLimitReached,
      setupPhase: chat.setupPhase,
      sendMessage: chat.sendMessage,
      submitAskUserReply: chat.submitAskUserReply,
      stopStreaming: chat.stopStreaming,
      startStreaming: chat.startStreaming,
      clearFileChanges: chat.clearFileChanges,
      modelId,
      onModelChange,
      activeSkills,
      onViewFiles,
      onFileSelect,
    }),
    [
      sessionId,
      chat.messages,
      chat.streamingParts,
      chat.status,
      isStreaming,
      chat.error,
      chat.liveFileChanges,
      chat.askUserPrompt,
      chat.activeRunId,
      chat.terminalReason,
      chat.stepLimitReached,
      chat.setupPhase,
      chat.sendMessage,
      chat.submitAskUserReply,
      chat.stopStreaming,
      chat.startStreaming,
      chat.clearFileChanges,
      modelId,
      onModelChange,
      activeSkills,
      onViewFiles,
      onFileSelect,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
ChatRoot.displayName = "Chat.Root";

export { ChatRoot };
export type { ChatRootProps };

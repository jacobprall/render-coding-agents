"use client";

import { createContext, useContext } from "react";
import type {
  Message,
  LiveFileChange,
  AskUserPrompt,
  ChatStatus,
  SetupPhase,
} from "../session/use-agent-chat";
import type { AssistantPart } from "@/lib/ui";

export interface ChatContextValue {
  sessionId: string;
  messages: Message[];
  streamingParts: AssistantPart[];
  status: ChatStatus;
  isStreaming: boolean;
  error: string | null;
  liveFileChanges: LiveFileChange[];
  askUserPrompt: AskUserPrompt | null;
  activeRunId: string | null;
  terminalReason: string | null;
  stepLimitReached: boolean;
  setupPhase: SetupPhase | null;
  sendMessage: (
    content: string,
    turnSkillRefs?: Array<{ source: string; slug: string }>,
  ) => Promise<void>;
  submitAskUserReply: (answer: string) => Promise<void>;
  stopStreaming: () => Promise<void>;
  startStreaming: (runId?: string) => void;
  clearFileChanges: () => void;
  modelId: string;
  onModelChange: (modelId: string) => void;
  activeSkills: Array<{ source: string; slug: string }>;
  onViewFiles?: () => void;
  onFileSelect?: (path: string) => void;
}

export const ChatContext = createContext<ChatContextValue | null>(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("Must be used within Chat.Root");
  return ctx;
}

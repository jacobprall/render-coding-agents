"use client";

import {
  useReducer,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  startTransition,
} from "react";
import { useEventSource } from "@/hooks/use-event-source";
import { notifyFileTreeChange } from "@/hooks/use-file-tree";
import { apiFetch } from "@/lib/api-fetch";
import type { StreamEvent } from "@coding-agents/shared";
import {
  chatReducer,
  initialChatState,
  MAX_NO_RUN_RETRIES,
  type Message,
  type ChatStatus,
  type LiveFileChange,
  type AskUserPrompt,
} from "./chat-reducer";

const MAX_SEEN_IDS = 5000;
const NO_RUN_RETRY_DELAY_MS = 2000;

export type { Message, LiveFileChange, AskUserPrompt, ChatStatus };

interface UseAgentChatOptions {
  sessionId: string;
  modelId: string;
  activeRunId?: string | null;
  initialMessages?: Message[];
  initialTerminalReason?: string | null;
  onFileChanges?: (files: LiveFileChange[]) => void;
  onTitleChange?: (title: string) => void;
}

export interface UseAgentChatReturn {
  messages: Message[];
  streamingParts: import("@/lib/ui").AssistantPart[];
  status: ChatStatus;
  error: string | null;
  liveFileChanges: LiveFileChange[];
  askUserPrompt: AskUserPrompt | null;
  activeRunId: string | null;
  terminalReason: string | null;
  stepLimitReached: boolean;
  sendMessage: (content: string) => Promise<void>;
  submitAskUserReply: (answer: string) => Promise<void>;
  stopStreaming: () => Promise<void>;
  startStreaming: (runId?: string) => void;
  addUserMessage: (message: Message) => void;
  clearError: () => void;
  clearFileChanges: () => void;
}

export function useAgentChat({
  sessionId,
  modelId,
  activeRunId: externalRunId,
  initialMessages = [],
  initialTerminalReason = null,
  onFileChanges,
  onTitleChange,
}: UseAgentChatOptions): UseAgentChatReturn {
  const [state, dispatch] = useReducer(
    chatReducer,
    { initialMessages, initialTerminalReason },
    ({ initialMessages: msgs, initialTerminalReason: reason }) =>
      initialChatState(msgs, { terminalReason: reason }),
  );

  const seenIds = useRef(new Set<string>());
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFileChangesRef = useRef(onFileChanges);
  onFileChangesRef.current = onFileChanges;
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;

  useEffect(() => {
    if (externalRunId) {
      dispatch({ type: "SET_ACTIVE_RUN_ID", runId: externalRunId });
    }
  }, [externalRunId]);

  useEffect(() => {
    onFileChangesRef.current?.(state.liveFileChanges);
  }, [state.liveFileChanges]);

  const isActive = state.status === "streaming" || state.status === "waitingForRun";
  const streamUrl = useMemo(
    () => (sessionId && isActive ? `/api/sessions/${sessionId}/stream` : null),
    [sessionId, isActive],
  );

  const evictSeenIds = useCallback(() => {
    if (seenIds.current.size <= MAX_SEEN_IDS) return;
    const entries = Array.from(seenIds.current);
    const toRemove = entries.slice(0, Math.floor(entries.length / 2));
    for (const id of toRemove) {
      seenIds.current.delete(id);
    }
  }, []);

  const handleSSEMessage = useCallback((event: MessageEvent) => {
    const eventId: string | undefined = (
      event as MessageEvent & { lastEventId?: string }
    ).lastEventId;

    if (eventId) {
      if (seenIds.current.has(eventId)) return;
      seenIds.current.add(eventId);
      evictSeenIds();
    }

    const rawData =
      typeof event.data === "string" ? event.data : String(event.data ?? "");

    try {
      const parsed = JSON.parse(rawData) as Record<string, unknown>;
      delete parsed._sid;

      const type = parsed.type as string | undefined;

      if (type === "connected") return;

      if (type === "no_active_run") {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        startTransition(() => {
          dispatch({ type: "NO_ACTIVE_RUN" });
        });
        if (state.noRunRetries < MAX_NO_RUN_RETRIES) {
          retryTimerRef.current = setTimeout(() => {
            esRef.current?.reconnect();
          }, NO_RUN_RETRY_DELAY_MS);
        }
        return;
      }

      const streamEvent = parsed as unknown as StreamEvent;

      if (streamEvent.type === "agent:file_changed") {
        const path = streamEvent.payload?.path;
        if (typeof path === "string") {
          notifyFileTreeChange(path);
        }
      }

      startTransition(() => {
        dispatch({ type: "STREAM_EVENT", event: streamEvent });
      });
    } catch (e) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[SSE parse error]", e, rawData.slice(0, 200));
      }
    }
  }, [evictSeenIds, state.noRunRetries]);

  const es = useEventSource({
    url: streamUrl,
    enabled: isActive,
    onMessage: handleSSEMessage,
    maxReconnectAttempts: 5,
    reconnectInterval: 2000,
  });
  const esRef = useRef(es);
  esRef.current = es;

  useEffect(() => {
    if (es.status === "error" && isActive) {
      dispatch({ type: "SET_ERROR", error: "Lost connection to server" });
    }
  }, [es.status, isActive]);

  const startStreaming = useCallback(
    (runId?: string) => {
      seenIds.current.clear();
      es.resetLastEventId();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      dispatch({ type: "START_STREAMING", runId });
    },
    [es.resetLastEventId],
  );

  const addUserMessage = useCallback((message: Message) => {
    dispatch({ type: "ADD_USER_MESSAGE", message });
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: "CLEAR_ERROR" });
  }, []);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isActive) return;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: content }],
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "ADD_USER_MESSAGE", message: userMessage });
      dispatch({ type: "CLEAR_ERROR" });
      dispatch({ type: "START_STREAMING" });

      try {
        const body: Record<string, unknown> = { content };
        if (modelId) body.modelId = modelId;

        const { ok, data } = await apiFetch<{
          error?: string;
          isFirstMessage?: boolean;
        }>(
          `/api/sessions/${sessionId}/message`,
          { method: "POST", body },
        );

        if (!ok) {
          dispatch({
            type: "SET_ERROR",
            error:
              typeof data.error === "string"
                ? data.error
                : "Failed to send message",
          });
          return;
        }

        if (data.isFirstMessage) {
          apiFetch<{ ok?: boolean; title?: string }>(
            `/api/sessions/${sessionId}/auto-title`,
            { method: "POST" },
          ).then(({ ok: titleOk, data: titleData }) => {
            if (titleOk && titleData.title) {
              onTitleChangeRef.current?.(titleData.title);
            }
          }).catch(() => {});
        }
      } catch {
        dispatch({ type: "SET_ERROR", error: "Network error -- failed to send message" });
      }
    },
    [sessionId, modelId, isActive],
  );

  const submitAskUserReply = useCallback(
    async (answer: string) => {
      const runId = state.activeRunId;
      const toolCallId = state.askUserPrompt?.toolCallId;
      if (!toolCallId || !runId) return;

      dispatch({ type: "SET_ASK_USER", prompt: null });

      try {
        const { ok, data } = await apiFetch<{ error?: string }>(
          `/api/sessions/${sessionId}/reply`,
          {
            method: "POST",
            body: { toolCallId, message: answer, runId },
          },
        );
        if (!ok) {
          dispatch({
            type: "SET_ERROR",
            error:
              typeof data.error === "string"
                ? data.error
                : "Failed to send reply to agent",
          });
        }
      } catch {
        dispatch({ type: "SET_ERROR", error: "Network error -- reply failed" });
      }
    },
    [sessionId, state.activeRunId, state.askUserPrompt?.toolCallId],
  );

  const stopStreaming = useCallback(async () => {
    try {
      await apiFetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
    } catch {
      // best effort
    }
    const safetyTimeout = setTimeout(() => {
      dispatch({ type: "FINISH_STREAMING" });
    }, 10_000);
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = safetyTimeout;
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const clearFileChanges = useCallback(() => {
    dispatch({ type: "CLEAR_FILE_CHANGES" });
  }, []);

  return {
    messages: state.messages,
    streamingParts: state.streamingParts,
    status: state.status,
    error: state.error,
    liveFileChanges: state.liveFileChanges,
    askUserPrompt: state.askUserPrompt,
    activeRunId: state.activeRunId,
    terminalReason: state.terminalReason,
    stepLimitReached: state.stepLimitReached,
    sendMessage,
    submitAskUserReply,
    stopStreaming,
    startStreaming,
    addUserMessage,
    clearError,
    clearFileChanges,
  };
}

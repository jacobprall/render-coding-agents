"use client";

import {
  useReducer,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useEventSource } from "@/hooks/use-event-source";
import { notifyFileTreeChange } from "@/hooks/use-file-tree";
import { apiFetch } from "@/lib/api-fetch";
import { isTerminalEvent, type StreamEvent } from "@coding-agents/shared/client";
import {
  chatReducer,
  initialChatState,
  MAX_NO_RUN_RETRIES,
  type Message,
  type ChatStatus,
  type LiveFileChange,
  type AskUserPrompt,
  type SetupPhase,
} from "./chat-reducer";

const MAX_SEEN_IDS = 5000;
const NO_RUN_RETRY_DELAY_MS = 200;

export type { Message, LiveFileChange, AskUserPrompt, ChatStatus, SetupPhase };

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
  setupPhase: SetupPhase | null;
  sendMessage: (
    content: string,
    turnSkillRefs?: Array<{ source: string; slug: string }>,
  ) => Promise<void>;
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
  const stopSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(state.status);
  const noRunRetriesRef = useRef(state.noRunRetries);
  const activeRunIdRef = useRef(state.activeRunId);
  statusRef.current = state.status;
  noRunRetriesRef.current = state.noRunRetries;
  activeRunIdRef.current = state.activeRunId;
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

        const currentStatus = statusRef.current;
        if (
          currentStatus === "done" ||
          currentStatus === "idle" ||
          currentStatus === "error"
        ) {
          esRef.current?.close();
          return;
        }

        // Stale run or post-terminal reconnect — reducer will finish immediately.
        if (currentStatus === "streaming" && activeRunIdRef.current) {
          dispatch({ type: "NO_ACTIVE_RUN" });
          esRef.current?.close();
          return;
        }

        const nextRetries = noRunRetriesRef.current + 1;
        dispatch({ type: "NO_ACTIVE_RUN" });

        if (
          currentStatus === "waitingForRun" &&
          nextRetries < MAX_NO_RUN_RETRIES
        ) {
          retryTimerRef.current = setTimeout(() => {
            esRef.current?.reconnect();
          }, NO_RUN_RETRY_DELAY_MS);
        } else {
          esRef.current?.close();
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

      if (isTerminalEvent(streamEvent)) {
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
        dispatch({ type: "STREAM_EVENT", event: streamEvent });
        esRef.current?.close();
        return;
      }

      dispatch({ type: "STREAM_EVENT", event: streamEvent });
    } catch (e) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[SSE parse error]", e, rawData.slice(0, 200));
      }
    }
  }, [evictSeenIds]);

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
    async (
      content: string,
      turnSkillRefs?: Array<{ source: string; slug: string }>,
    ) => {
      const text =
        content.trim() ||
        (turnSkillRefs?.length
          ? `Use skill: ${turnSkillRefs.map((s) => s.slug).join(", ")}`
          : "");
      if (!text || isActive) return;

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text }],
        createdAt: new Date().toISOString(),
      };
      dispatch({ type: "ADD_USER_MESSAGE", message: userMessage });
      dispatch({ type: "CLEAR_ERROR" });

      try {
        const body: Record<string, unknown> = { content: text };
        if (modelId) body.modelId = modelId;
        if (turnSkillRefs?.length) body.turnSkillRefs = turnSkillRefs;

        const { ok, data } = await apiFetch<{
          error?: string;
          runId?: string;
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

        // Open SSE *after* POST completes with a known runId — avoids
        // the no_active_run race that added 200-600ms of retry delay.
        dispatch({ type: "START_STREAMING", runId: data.runId });

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
    if (stopSafetyTimerRef.current) clearTimeout(stopSafetyTimerRef.current);
    stopSafetyTimerRef.current = setTimeout(() => {
      dispatch({ type: "FINISH_STREAMING" });
    }, 10_000);
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      if (stopSafetyTimerRef.current) clearTimeout(stopSafetyTimerRef.current);
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
    setupPhase: state.setupPhase,
    sendMessage,
    submitAskUserReply,
    stopStreaming,
    startStreaming,
    addUserMessage,
    clearError,
    clearFileChanges,
  };
}

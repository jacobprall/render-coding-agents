import type { AssistantPart } from "@/lib/ui";
import { appendStreamEvent } from "@/lib/ui";
import type { StreamEvent } from "@coding-agents/shared";
import { isTerminalEvent } from "@coding-agents/shared";

export const MAX_NO_RUN_RETRIES = 30;

export interface LiveFileChange {
  path: string;
  additions: number;
  deletions: number;
  unifiedDiffPreview?: string;
}

export interface AskUserPrompt {
  question: string;
  options: string[];
  toolCallId?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: AssistantPart[];
  createdAt: string;
  totalDurationMs?: number;
}

export type ChatStatus = "idle" | "waitingForRun" | "streaming" | "done" | "error";

export interface ChatState {
  messages: Message[];
  streamingParts: AssistantPart[];
  status: ChatStatus;
  error: string | null;
  liveFileChanges: LiveFileChange[];
  askUserPrompt: AskUserPrompt | null;
  activeRunId: string | null;
  noRunRetries: number;
  stepLimitReached: boolean;
  terminalReason: string | null;
  _seqCounter: number;
}

export type ChatAction =
  | { type: "START_STREAMING"; runId?: string }
  | { type: "STREAM_EVENT"; event: StreamEvent }
  | { type: "FINISH_STREAMING" }
  | { type: "SET_ERROR"; error: string }
  | { type: "CLEAR_ERROR" }
  | { type: "ADD_USER_MESSAGE"; message: Message }
  | { type: "SET_ASK_USER"; prompt: AskUserPrompt | null }
  | { type: "NO_ACTIVE_RUN" }
  | { type: "SET_ACTIVE_RUN_ID"; runId: string }
  | { type: "CLEAR_FILE_CHANGES" }
  | { type: "RESET" };

function flushStreamingToMessages(
  messages: Message[],
  streamingParts: AssistantPart[],
): { messages: Message[]; streamingParts: AssistantPart[] } {
  if (streamingParts.length === 0) {
    return { messages, streamingParts: [] };
  }
  const msg: Message = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: streamingParts,
    createdAt: new Date().toISOString(),
  };
  return { messages: [...messages, msg], streamingParts: [] };
}

function mergeLiveChange(
  list: LiveFileChange[],
  path: string,
  additions: number,
  deletions: number,
  unifiedDiffPreview?: string,
): LiveFileChange[] {
  return [
    ...list.filter((e) => e.path !== path),
    { path, additions, deletions, unifiedDiffPreview },
  ].sort((a, b) => a.path.localeCompare(b.path));
}

export function initialChatState(
  initialMessages: Message[],
  opts?: { terminalReason?: string | null },
): ChatState {
  const terminalReason = opts?.terminalReason ?? null;
  return {
    messages: initialMessages,
    streamingParts: [],
    status: "idle",
    error: null,
    liveFileChanges: [],
    askUserPrompt: null,
    activeRunId: null,
    noRunRetries: 0,
    stepLimitReached: terminalReason === "step_limit",
    terminalReason,
    _seqCounter: 0,
  };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "START_STREAMING":
      return {
        ...state,
        status: action.runId ? "streaming" : "waitingForRun",
        streamingParts: [],
        liveFileChanges: [],
        error: null,
        activeRunId: action.runId ?? null,
        noRunRetries: 0,
        stepLimitReached: false,
        terminalReason: null,
        _seqCounter: 0,
      };

    case "FINISH_STREAMING": {
      const flushed = flushStreamingToMessages(state.messages, state.streamingParts);
      return {
        ...state,
        ...flushed,
        status: "done",
        liveFileChanges: [],
        askUserPrompt: null,
      };
    }

    case "SET_ERROR": {
      const flushed = flushStreamingToMessages(state.messages, state.streamingParts);
      return { ...state, ...flushed, error: action.error, status: "error" };
    }

    case "CLEAR_ERROR":
      return {
        ...state,
        error: null,
        status: state.status === "error" ? "idle" : state.status,
      };

    case "ADD_USER_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };

    case "SET_ASK_USER":
      return { ...state, askUserPrompt: action.prompt };

    case "NO_ACTIVE_RUN": {
      const noRunRetries = state.noRunRetries + 1;
      if (noRunRetries >= MAX_NO_RUN_RETRIES) {
        const flushed = flushStreamingToMessages(state.messages, state.streamingParts);
        return {
          ...state,
          ...flushed,
          noRunRetries,
          error: "Agent job did not start. Try sending another message.",
          status: "error",
        };
      }
      return { ...state, noRunRetries };
    }

    case "SET_ACTIVE_RUN_ID":
      return { ...state, activeRunId: action.runId };

    case "CLEAR_FILE_CHANGES":
      return { ...state, liveFileChanges: [] };

    case "RESET":
      return { ...initialChatState(state.messages) };

    case "STREAM_EVENT": {
      if (state.status === "done" || state.status === "error") return state;
      if (state.status === "idle") return state;

      const { event } = action;
      const p = event.payload;

      if (isTerminalEvent(event)) {
        let partsToFlush = state.streamingParts;
        if (partsToFlush.length === 0 && p.assistantParts && Array.isArray(p.assistantParts)) {
          partsToFlush = p.assistantParts as AssistantPart[];
        }
        const flushed = flushStreamingToMessages(state.messages, partsToFlush);
        const terminalReason = typeof p.terminalReason === "string" ? p.terminalReason : null;
        const isStepLimit = terminalReason === "step_limit";

        if (event.type === "session:failed") {
          return {
            ...state,
            ...flushed,
            error: (typeof p.message === "string" ? p.message : null) ?? "An error occurred",
            status: "error",
            liveFileChanges: [],
            askUserPrompt: null,
            stepLimitReached: isStepLimit,
            terminalReason,
          };
        }
        return {
          ...state,
          ...flushed,
          status: "done",
          liveFileChanges: [],
          askUserPrompt: null,
          stepLimitReached: isStepLimit,
          terminalReason,
        };
      }

      let nextStatus: ChatStatus = state.status;
      if (state.status === "waitingForRun") {
        nextStatus = "streaming";
      }

      let liveFileChanges = state.liveFileChanges;
      if (event.type === "agent:file_changed" && typeof p.path === "string") {
        liveFileChanges = mergeLiveChange(
          liveFileChanges,
          p.path,
          (p.additions ?? 0) as number,
          (p.deletions ?? 0) as number,
          p.unifiedDiffPreview as string | undefined,
        );
      }

      let askUserPrompt = state.askUserPrompt;
      if (event.type === "agent:ask_user") {
        askUserPrompt = {
          question: (p.question ?? "") as string,
          options: (p.options ?? []) as string[],
          toolCallId: p.toolCallId as string | undefined,
        };
      }

      const seq = { current: state._seqCounter };
      const streamingParts = appendStreamEvent(state.streamingParts, event, seq);

      return {
        ...state,
        status: nextStatus,
        streamingParts,
        _seqCounter: seq.current,
        liveFileChanges,
        askUserPrompt,
      };
    }

    default:
      return state;
  }
}

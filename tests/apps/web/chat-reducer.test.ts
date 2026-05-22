import { describe, expect, test } from "bun:test";
import {
  chatReducer,
  initialChatState,
  MAX_NO_RUN_RETRIES,
  type ChatState,
  type Message,
} from "../../../apps/web/components/session/chat-reducer";
import type { StreamEvent } from "../../../packages/shared/lib/stream-types";

function makeState(overrides: Partial<ChatState> = {}): ChatState {
  return { ...initialChatState([]), ...overrides };
}

describe("chatReducer", () => {
  describe("START_STREAMING", () => {
    test("transitions from idle to waitingForRun when no runId", () => {
      const state = chatReducer(makeState(), { type: "START_STREAMING" });
      expect(state.status).toBe("waitingForRun");
      expect(state.streamingParts).toEqual([]);
      expect(state.noRunRetries).toBe(0);
    });

    test("transitions directly to streaming when runId provided", () => {
      const state = chatReducer(makeState(), {
        type: "START_STREAMING",
        runId: "run-1",
      });
      expect(state.status).toBe("streaming");
      expect(state.activeRunId).toBe("run-1");
    });

    test("resets sequence counter", () => {
      const state = chatReducer(makeState({ _seqCounter: 42 }), {
        type: "START_STREAMING",
      });
      expect(state._seqCounter).toBe(0);
    });
  });

  describe("FINISH_STREAMING", () => {
    test("flushes streaming parts into a message when streaming", () => {
      const state = makeState({
        status: "streaming",
        streamingParts: [{ type: "text", text: "hello", id: "text-0" }],
      });
      const next = chatReducer(state, { type: "FINISH_STREAMING" });
      expect(next.status).toBe("done");
      expect(next.streamingParts).toEqual([]);
      expect(next.messages).toHaveLength(1);
      expect(next.messages[0]!.role).toBe("assistant");
      expect(next.messages[0]!.parts[0]).toEqual({ type: "text", text: "hello", id: "text-0" });
    });

    test("flushes from any state (guard removed for stop-preserves-work)", () => {
      for (const status of ["idle", "done", "error"] as const) {
        const state = makeState({
          status,
          streamingParts: [{ type: "text", text: "partial", id: "text-0" }],
        });
        const next = chatReducer(state, { type: "FINISH_STREAMING" });
        expect(next.status).toBe("done");
        expect(next.streamingParts).toEqual([]);
        expect(next.messages).toHaveLength(1);
      }
    });

    test("does not create an empty assistant message when parts are empty", () => {
      const state = makeState({ status: "streaming", streamingParts: [] });
      const next = chatReducer(state, { type: "FINISH_STREAMING" });
      expect(next.messages).toEqual([]);
      expect(next.status).toBe("done");
    });
  });

  describe("STREAM_EVENT - terminal state lockout", () => {
    test("drops events when status is done", () => {
      const state = makeState({ status: "done" });
      const event: StreamEvent = { type: "token", token: "hi" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next).toBe(state);
    });

    test("drops events when status is error", () => {
      const state = makeState({ status: "error" });
      const event: StreamEvent = { type: "token", token: "hi" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next).toBe(state);
    });

    test("drops events when status is idle", () => {
      const state = makeState({ status: "idle" });
      const event: StreamEvent = { type: "token", token: "hi" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next).toBe(state);
    });
  });

  describe("STREAM_EVENT - token processing", () => {
    test("appends token to streaming parts", () => {
      const state = makeState({ status: "streaming" });
      const event: StreamEvent = { type: "token", token: "hello" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.streamingParts).toHaveLength(1);
      expect(next.streamingParts[0]).toMatchObject({ type: "text", text: "hello" });
    });

    test("transitions waitingForRun to streaming on first event", () => {
      const state = makeState({ status: "waitingForRun" });
      const event: StreamEvent = { type: "token", token: "first" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.status).toBe("streaming");
    });
  });

  describe("STREAM_EVENT - tool_call idempotency", () => {
    test("appends a new tool_call part", () => {
      const state = makeState({ status: "streaming" });
      const event: StreamEvent = {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName: "bash",
        args: { cmd: "ls" },
      };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.streamingParts).toHaveLength(1);
      expect(next.streamingParts[0]).toMatchObject({
        type: "tool_call",
        toolCallId: "tc-1",
        id: "tc-1",
      });
    });

    test("deduplicates tool_call by toolCallId", () => {
      const state = makeState({
        status: "streaming",
        streamingParts: [
          { type: "tool_call", toolCallId: "tc-1", toolName: "bash", id: "tc-1" },
        ],
      });
      const event: StreamEvent = {
        type: "tool_call",
        toolCallId: "tc-1",
        toolName: "bash",
      };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.streamingParts).toHaveLength(1);
    });
  });

  describe("STREAM_EVENT - terminal events", () => {
    test("done event flushes parts and transitions to done", () => {
      const state = makeState({
        status: "streaming",
        streamingParts: [{ type: "text", text: "result", id: "text-0" }],
      });
      const event: StreamEvent = { type: "done" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.status).toBe("done");
      expect(next.streamingParts).toEqual([]);
      expect(next.messages).toHaveLength(1);
    });

    test("error event sets error message and transitions to error", () => {
      const state = makeState({ status: "streaming" });
      const event: StreamEvent = { type: "error", message: "something broke" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.status).toBe("error");
      expect(next.error).toBe("something broke");
    });

    test("aborted event flushes parts and transitions to done", () => {
      const state = makeState({ status: "streaming", streamingParts: [] });
      const event: StreamEvent = { type: "aborted" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.status).toBe("done");
    });
  });

  describe("STREAM_EVENT - file_changed", () => {
    test("updates liveFileChanges with dedup by path", () => {
      const state = makeState({ status: "streaming" });
      const event: StreamEvent = {
        type: "file_changed",
        path: "src/app.ts",
        additions: 5,
        deletions: 2,
      };
      let next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.liveFileChanges).toEqual([
        { path: "src/app.ts", additions: 5, deletions: 2 },
      ]);

      const event2: StreamEvent = {
        type: "file_changed",
        path: "src/app.ts",
        additions: 10,
        deletions: 3,
      };
      next = chatReducer(next, { type: "STREAM_EVENT", event: event2 });
      expect(next.liveFileChanges).toHaveLength(1);
      expect(next.liveFileChanges[0]).toEqual({
        path: "src/app.ts",
        additions: 10,
        deletions: 3,
      });
    });
  });

  describe("STREAM_EVENT - ask_user", () => {
    test("sets askUserPrompt", () => {
      const state = makeState({ status: "streaming" });
      const event: StreamEvent = {
        type: "ask_user",
        question: "Continue?",
        options: ["yes", "no"],
        toolCallId: "ask-1",
      };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.askUserPrompt).toEqual({
        question: "Continue?",
        options: ["yes", "no"],
        toolCallId: "ask-1",
      });
    });
  });

  describe("NO_ACTIVE_RUN", () => {
    test("increments retry count", () => {
      const state = makeState({ status: "waitingForRun", noRunRetries: 0 });
      const next = chatReducer(state, { type: "NO_ACTIVE_RUN" });
      expect(next.noRunRetries).toBe(1);
    });

    test("sets error after max retries", () => {
      const state = makeState({ status: "waitingForRun", noRunRetries: MAX_NO_RUN_RETRIES - 1 });
      const next = chatReducer(state, { type: "NO_ACTIVE_RUN" });
      expect(next.status).toBe("error");
      expect(next.error).toContain("did not start");
    });
  });

  describe("ADD_USER_MESSAGE", () => {
    test("appends to messages", () => {
      const msg: Message = {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
        createdAt: "2025-01-01",
      };
      const state = chatReducer(makeState(), {
        type: "ADD_USER_MESSAGE",
        message: msg,
      });
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]!.id).toBe("m1");
    });
  });

  describe("SET_ACTIVE_RUN_ID", () => {
    test("stores run id", () => {
      const state = chatReducer(makeState(), {
        type: "SET_ACTIVE_RUN_ID",
        runId: "run-abc",
      });
      expect(state.activeRunId).toBe("run-abc");
    });
  });

  describe("CLEAR_ERROR", () => {
    test("clears error and transitions error status back to idle", () => {
      const state = makeState({ status: "error", error: "fail" });
      const next = chatReducer(state, { type: "CLEAR_ERROR" });
      expect(next.error).toBeNull();
      expect(next.status).toBe("idle");
    });

    test("preserves non-error status", () => {
      const state = makeState({ status: "streaming", error: "warn" });
      const next = chatReducer(state, { type: "CLEAR_ERROR" });
      expect(next.error).toBeNull();
      expect(next.status).toBe("streaming");
    });
  });

  describe("STREAM_EVENT - terminalReason and stepLimitReached", () => {
    test("done event with terminalReason='step_limit' sets stepLimitReached", () => {
      const state = makeState({ status: "streaming" });
      const event: StreamEvent = { type: "done", terminalReason: "step_limit" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.stepLimitReached).toBe(true);
      expect(next.terminalReason).toBe("step_limit");
    });

    test("done event with terminalReason='end_turn' does not set stepLimitReached", () => {
      const state = makeState({ status: "streaming" });
      const event: StreamEvent = { type: "done", terminalReason: "end_turn" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.stepLimitReached).toBe(false);
      expect(next.terminalReason).toBe("end_turn");
    });

    test("aborted event with terminalReason='stopped' sets terminalReason", () => {
      const state = makeState({ status: "streaming" });
      const event: StreamEvent = { type: "aborted", terminalReason: "stopped" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.status).toBe("done");
      expect(next.terminalReason).toBe("stopped");
    });

    test("error event with terminalReason='provider_transient' sets terminalReason", () => {
      const state = makeState({ status: "streaming" });
      const event: StreamEvent = { type: "error", message: "Rate limited", terminalReason: "provider_transient" };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.status).toBe("error");
      expect(next.terminalReason).toBe("provider_transient");
    });

    test("terminal event uses server assistantParts when streamingParts is empty", () => {
      const state = makeState({ status: "streaming", streamingParts: [] });
      const event: StreamEvent = {
        type: "done",
        assistantParts: [{ type: "text", text: "server content" }],
      };
      const next = chatReducer(state, { type: "STREAM_EVENT", event });
      expect(next.messages).toHaveLength(1);
      expect(next.messages[0]!.parts[0]).toMatchObject({ type: "text", text: "server content" });
    });
  });

  describe("SET_ERROR flushes streaming parts", () => {
    test("flushes parts before setting error", () => {
      const state = makeState({
        status: "streaming",
        streamingParts: [{ type: "text", text: "partial", id: "text-0" }],
      });
      const next = chatReducer(state, { type: "SET_ERROR", error: "Connection lost" });
      expect(next.status).toBe("error");
      expect(next.error).toBe("Connection lost");
      expect(next.streamingParts).toEqual([]);
      expect(next.messages).toHaveLength(1);
    });
  });

  describe("NO_ACTIVE_RUN flushes on exhaustion", () => {
    test("flushes parts when max retries exceeded", () => {
      const state = makeState({
        status: "waitingForRun",
        noRunRetries: MAX_NO_RUN_RETRIES - 1,
        streamingParts: [{ type: "text", text: "partial", id: "text-0" }],
      });
      const next = chatReducer(state, { type: "NO_ACTIVE_RUN" });
      expect(next.status).toBe("error");
      expect(next.streamingParts).toEqual([]);
      expect(next.messages).toHaveLength(1);
    });
  });

  describe("START_STREAMING resets stepLimitReached and terminalReason", () => {
    test("resets stepLimitReached and terminalReason", () => {
      const state = makeState({ stepLimitReached: true, terminalReason: "step_limit" });
      const next = chatReducer(state, { type: "START_STREAMING" });
      expect(next.stepLimitReached).toBe(false);
      expect(next.terminalReason).toBeNull();
    });
  });

  describe("RESET", () => {
    test("returns to initial state but keeps messages", () => {
      const msg: Message = {
        id: "m1",
        role: "user",
        parts: [{ type: "text", text: "hi" }],
        createdAt: "2025-01-01",
      };
      const state = makeState({
        messages: [msg],
        status: "error",
        error: "bad",
        streamingParts: [{ type: "text", text: "x", id: "text-0" }],
      });
      const next = chatReducer(state, { type: "RESET" });
      expect(next.messages).toEqual([msg]);
      expect(next.status).toBe("idle");
      expect(next.error).toBeNull();
      expect(next.streamingParts).toEqual([]);
    });
  });
});

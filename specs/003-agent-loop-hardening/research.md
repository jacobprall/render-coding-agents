# Research: Agent Loop & Chat Reliability Hardening

**Branch**: `003-agent-loop-hardening` | **Date**: 2026-05-21

## Research Questions

### RQ-1: Incremental persistence strategy for assistant turn content

**Decision**: Write-ahead per-step persistence to `chat_messages.parts` using upsert (INSERT ON CONFLICT UPDATE).

**Rationale**: The core brittleness is that assistant content only reaches Postgres at turn end. We need incremental persistence at natural boundaries (completed LLM response + completed tool results = one "step"). The simplest approach that fits the existing schema:

1. After each completed step in `agentLoop`, the `onStep` callback persists the current `assistantParts` array to the existing `chat_messages` row via upsert.
2. First step: INSERT a new `chat_messages` row (role=assistant) with the initial parts. Subsequent steps: UPDATE the same row's `parts` column.
3. The row carries a `runId` reference so we know which run produced it (for idempotency).
4. On reload, `page.tsx` reads `chat_messages` as today — but now assistant rows exist mid-turn, not only at turn end.

**Alternatives considered**:
- **Separate `run_events` table** (event-sourced rebuild): More complex, requires projection logic, adds a new table. Rejected per constitution principle I (Simplicity).
- **Rebuild from `agent_events`** (observability table): Conflates ops-facing data with user-facing transcript. Rejected per assumption in spec.
- **Rebuild from Redis stream on reload**: Redis stream is ephemeral (24h TTL, ~2000 cap). Rejected per FR-003 (durable storage must be authoritative).

### RQ-2: Abort signal propagation to LLM stream and tools

**Decision**: Wire the user-abort Redis flag into the `AbortController.signal` that is already passed to the LLM `provider.chat()` call. Also pass the same signal to tool `execute()` calls.

**Rationale**: Currently `abortController` is only tied to a timeout. Adding a second abort source (user stop) is straightforward:
1. Create a merged `AbortController` that fires when either the timeout or the Redis abort flag triggers.
2. Poll the Redis abort flag on a short interval (500ms) during tool execution and LLM streaming, calling `abortController.abort()` when detected.
3. Pass the signal to `tool.execute(input, toolCallId, { signal })` — tools that support cooperative cancellation (bash via process.kill, ask_user via BLPOP timeout) can honor it.
4. On abort, the LLM stream reader throws; the loop catches it and proceeds to the abort-persist path.

**Alternatives considered**:
- **Redis pub/sub for instant abort notification**: Lower latency but adds subscription complexity per-run. 500ms polling is sufficient for the 5s SC-002 target. Can upgrade later.
- **Passing abort signal only between steps (status quo)**: Doesn't meet FR-012 or SC-002 for long-running tools.

### RQ-3: SSE reconnect and durable replay

**Decision**: On reconnect, the SSE handler reads from the `chat_messages` table (durable) for the completed portion of the conversation, then reads from the Redis stream only for events after the last persisted state.

**Rationale**: The current SSE endpoint replays from the Redis stream only, which has a 24h TTL and ~2000 entry cap. With incremental persistence (RQ-1), the durable source of truth (`chat_messages`) is always up to date within one step. The SSE reconnect can:
1. Read the latest `chat_messages.parts` for the active assistant row.
2. Use the stream's `Last-Event-ID` mechanism for events after that checkpoint.
3. The client receives the complete state on reconnect without depending on Redis retaining the full history.

On reload (full page): `page.tsx` already reads `chat_messages`. With RQ-1 in place, the query returns mid-turn content. If the run is still active, `autoStream` attaches SSE for live events; dedup is handled by matching `toolCallId` / event sequence number.

**Alternatives considered**:
- **Dedicated replay endpoint** that merges DB + Redis: More API surface. Rejected; the existing SSE handler can do this internally.

### RQ-4: Silent loop exits — classification and retry

**Decision**: Extend the `agentLoop` return type with a `terminationReason` field and handle each case in `runAgentTurn`.

**Rationale**: Today, the loop's `break` after `toolUseBlocks.length === 0` is the only way it exits normally. This conflates "model said end_turn with text" (good) with "model returned empty/thinking-only" (bad). Changes:
1. Add `terminationReason: "end_turn" | "step_limit" | "empty_response" | "abort"` to `AgentLoopResult`.
2. When `toolUseBlocks.length === 0 && textBlocks.length === 0` and all content is thinking: set reason to `"empty_response"` and retry (up to 2x) inside the loop before breaking.
3. `runAgentTurn` maps each `terminationReason` to the documented terminal state set from FR-005.

**Alternatives considered**:
- **Handling retries outside the loop** (in `runAgentTurn`): Would require re-entering the loop with accumulated state. Messier than retrying inside.

### RQ-5: Transient LLM error retry with backoff

**Decision**: Wrap the `provider.chat()` call inside the loop with a retry helper (max 3 attempts, exponential backoff starting at 1s, max 30s).

**Rationale**: Currently, any provider error throws out of the loop and the run fails immediately. Transient errors (rate limits, 5xx, network resets) are common with LLM providers and should be retried.

The retry is limited to the `provider.chat()` call only (not tool execution). On each retry, the loop logs a warning via the observability recorder.

**Alternatives considered**:
- **Global retry at the worker level** (re-running the entire turn): Wasteful; re-executes already-completed tools. Rejected.
- **Provider-level retry** (inside `anthropic.ts` / `openai.ts`): Would work but hides retry logic inside adapters where it's harder to observe. Preferred: retry at the loop level where the recorder can instrument it.

### RQ-6: Idempotency guard for re-delivered jobs

**Decision**: At the start of `runAgentTurn`, check `agent_runs.status`. If it's already terminal (completed/aborted/failed/error), skip execution and ack the job.

**Rationale**: With at-least-once delivery from the Redis Streams consumer group, a job can be delivered twice (crash before ack). The guard is a single SELECT check.

For partial re-delivery (run is `running` from a previous attempt), the worker should check if an assistant message already exists for this `runId` to avoid inserting a duplicate. This covers FR-018 and FR-019.

**Alternatives considered**:
- **Distributed lock per runId**: Heavier, adds Redis lock complexity. The status check is simpler and sufficient given single-worker-per-job semantics.

### RQ-7: "Continue" button at step limit — resume mechanism

**Decision**: The "Continue" action sends a system message to the chat (not a user message) that re-enqueues the run with the current `modelMessages` context and an extended step budget. This preserves the LLM's conversation state without the user needing to compose a message.

**Rationale**: FR-009 requires both a continue button and a free-form input. The continue button triggers a purpose-built API (`POST /sessions/:id/continue`) that:
1. Creates a new `agent_runs` row with status `queued` and the prior run's `modelMessages` as context.
2. Sets `chats.activeRunId` to the new run.
3. The new run picks up where the old one left off.

The free-form input simply uses the existing `sendMessage` flow.

**Alternatives considered**:
- **Resuming the same run row**: Violates the "terminal states are final" model (FR-018). A new run is cleaner.

### RQ-8: Flush strategy on FINISH_STREAMING / SET_ERROR

**Decision**: Always flush `streamingParts` to `messages` on any terminal transition, regardless of the current `status` value. Remove the `if (state.status !== "streaming") return state` guard.

**Rationale**: The current guard causes content loss when Stop is pressed during `waitingForRun` or when `SET_ERROR` fires before `FINISH_STREAMING`. With incremental persistence (RQ-1), the flush is cosmetic (DB already has the data), but the UI should still show the content. The fix is simple: remove the guard.

Additionally, when a terminal SSE event (`done`, `aborted`, `error`) carries `assistantParts` from the server, the reducer should use those as a fallback if the local `streamingParts` buffer is empty (covers missed events).

### RQ-9: Per-run liveness heartbeat

**Decision**: The agent worker publishes a `heartbeat` event to the Redis stream every 15 seconds during active processing (LLM call or tool execution). The UI and recovery system use this to detect stalled runs.

**Rationale**: FR-025 requires a liveness signal. The heartbeat:
1. Is written to the same `run:{runId}:events` Redis stream, so it's visible to SSE consumers.
2. Carries a timestamp and the current activity (e.g., "llm_call", "tool:bash").
3. The UI can show a "last active X seconds ago" indicator.
4. The stale-run recovery system can finalize runs whose last heartbeat exceeds a threshold (5 minutes per SC-008).

**Alternatives considered**:
- **Separate Redis key with TTL**: Simpler but not visible to SSE consumers and adds another key to manage. The stream-based approach unifies the event channel.

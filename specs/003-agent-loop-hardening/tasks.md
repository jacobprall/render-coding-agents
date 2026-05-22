# Tasks: Agent Loop & Chat Reliability Hardening

**Input**: Design documents from `specs/003-agent-loop-hardening/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Schema & Type Foundation)

**Purpose**: Database migration + shared type definitions that all user stories depend on

- [ ] T001 Create migration file `apps/web/lib/db/migrations/0006_agent_loop_hardening.sql` — add `run_id TEXT REFERENCES agent_runs(id)` to `chat_messages`, add `terminal_reason TEXT` and `last_heartbeat_at TIMESTAMPTZ` to `agent_runs`, create index `idx_chat_messages_run_id`
- [ ] T002 Update Drizzle schema in `packages/db/schema/session.ts` — add `runId` column to `chatMessages` table, add `terminalReason` and `lastHeartbeatAt` columns to `agentRuns` table
- [ ] T003 [P] Export `TerminalReason` union type from `packages/platform/src/state-machine.ts` — define the 12 allowed `terminal_reason` values as a TypeScript union type (`end_turn | step_limit | stopped | timeout | coalesced | worker_lost | empty_response | provider_transient | provider_fatal | tool_fatal | internal | max_tokens`)
- [ ] T004 [P] Add `heartbeat`, `step_persisted`, and `terminalReason` fields to `StreamEvent` type in `apps/agent/src/types.ts` — extend the existing union with new event shapes per `contracts/api.md` section 1

---

## Phase 2: Foundational (Core Persistence & Abort Infrastructure)

**Purpose**: The two primitives every user story depends on — incremental persistence and signal-driven abort

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 Refactor `persistAssistantMessage` into `upsertAssistantMessage` in `apps/agent/src/run-persistence.ts` — first call INSERTs a new `chat_messages` row with `run_id`; subsequent calls UPDATE the same row's `parts` and `model_messages`. Accept `assistantMessageId` parameter (returned on first call, passed back on subsequent calls). Publish `step_persisted` event after each successful write
- [ ] T006 Add `terminal_reason` parameter to `updateRunStatus` in `apps/agent/src/run-persistence.ts` — pass through to the `agent_runs` UPDATE alongside `status`. Map each `(status, terminal_reason)` pair per data-model.md table
- [ ] T007 Add `updateHeartbeat` function to `apps/agent/src/run-persistence.ts` — UPDATE `agent_runs SET last_heartbeat_at = NOW() WHERE id = $runId`. Fire-and-forget (log warn on error, don't throw)
- [ ] T008 Create merged `AbortController` helper in `apps/agent/src/agent.ts` — combines turn-timeout signal and user-stop polling (check `run:{runId}:abort` every 500ms via `setInterval`). On either trigger, call `abortController.abort()`. Clear interval on run end. Export as reusable function

**Checkpoint**: Incremental persistence and signal-driven abort are available for all subsequent work

---

## Phase 3: User Story 1 — Conversation Survives Page Reload (Priority: P1) MVP

**Goal**: Every assistant text fragment, tool call, and tool result persisted incrementally so page reload shows complete conversation

**Independent Test**: Start a multi-step agent turn, hard-reload mid-turn — all previously-visible content appears. Reload after completion — full conversation intact.

### Implementation for User Story 1

- [ ] T009 [US1] Wire incremental persistence into `onStep` callback in `apps/agent/src/agent.ts` — call `upsertAssistantMessage` (from T005) after each step, passing accumulated `assistantParts`. Track `assistantMessageId` across steps. Replace the single end-of-turn `persistAssistantMessage` call with a final `upsertAssistantMessage` that includes `modelMessages`
- [ ] T010 [US1] Wire incremental persistence into all error/abort paths in `apps/agent/src/agent.ts` — `AbortError` handler, timeout handler, and generic error handler all call `upsertAssistantMessage` with whatever `assistantParts` exist. Remove the separate abort-persist/timeout-skip/error-skip logic; unify into a single `finally` block that does a final upsert if `assistantParts.length > 0`
- [ ] T011 [US1] Add `terminal_reason` to all terminal paths in `apps/agent/src/agent.ts` — pass the appropriate `TerminalReason` value to `updateRunStatus`: `end_turn` (normal), `step_limit`, `stopped` (AbortError), `timeout` (isTimeoutAbort), `provider_transient`/`provider_fatal` (LLM errors), `tool_fatal`, `internal` (catch-all)
- [ ] T012 [US1] Add `terminalReason` field to terminal SSE events in `apps/agent/src/agent.ts` — include `terminalReason` in `done`, `aborted`, and `error` `publishEvent` calls per contracts/api.md section 1.3. Include `assistantParts` in `aborted` events
- [ ] T013 [US1] Start heartbeat interval in `apps/agent/src/agent.ts` — at the start of `runTurn`, start a 15-second `setInterval` that calls `updateHeartbeat` (T007) and publishes a `heartbeat` stream event. Clear in `finally` block. Include current activity (`llm_call`, `tool:<name>`, or `idle`)
- [ ] T014 [P] [US1] Handle `heartbeat` and `step_persisted` event types in `apps/web/lib/ui/lib/chat-parts.ts` — add cases for new event types in `appendStreamEvent`. `heartbeat`: update last-active timestamp (no UI part change). `step_persisted`: record that DB is current (no UI part change)
- [ ] T015 [P] [US1] Load `terminal_reason` from `agent_runs` in `apps/web/app/(authenticated)/sessions/[id]/page.tsx` — join `agent_runs` to get `terminalReason` for the latest run; pass to `SessionWorkspace` as a prop for rendering terminal-state badges on reload

**Checkpoint**: Page reload during or after any agent turn shows the full conversation with correct terminal status

---

## Phase 4: User Story 2 — Stop Preserves In-Progress Work (Priority: P1)

**Goal**: Clicking Stop immediately cancels the current LLM/tool, preserves all visible content, and marks the turn "stopped"

**Independent Test**: Mid-turn with tool results visible, click Stop — content stays, "stopped" badge shows, reload confirms persistence

### Implementation for User Story 2

- [ ] T016 [US2] Wire merged abort controller into `runTurn` in `apps/agent/src/agent.ts` — replace the timeout-only `abortController` with the merged controller from T008. Pass the merged `signal` to `agentLoop` via `params.signal` and to tools via an `execOptions` parameter
- [ ] T017 [US2] Pass `AbortSignal` to tool execution in `apps/agent/src/loop.ts` — add `signal?: AbortSignal` to the `AgentTool.execute` signature. In the tool dispatch loop, pass `params.signal` to each `tool.execute(input, toolCallId, { signal })`. When signal fires mid-tool, catch the abort error, mark the tool call as `status: "interrupted"` in `stepToolCalls`, and break the tool loop
- [ ] T018 [US2] Honor `AbortSignal` in `ask_user` tool in `apps/agent/src/tools/ask-user.ts` — pass the signal to `abortableBlpop` so that Stop interrupts the user-reply wait
- [ ] T019 [US2] Honor `AbortSignal` in `bash` tool in `apps/agent/src/tools/bash.ts` — if the signal fires during command execution, send SIGTERM to the subprocess and resolve with partial output + `interrupted` status
- [ ] T020 [US2] Fix chat reducer `FINISH_STREAMING` guard in `apps/web/components/session/chat-reducer.ts` — remove the `if (state.status !== "streaming") return state` guard. Always flush `streamingParts` to `messages` when `FINISH_STREAMING` is dispatched, regardless of current status
- [ ] T021 [US2] Fix chat reducer `SET_ERROR` to flush in `apps/web/components/session/chat-reducer.ts` — on `SET_ERROR`, call `flushStreamingToMessages` before setting error state, so visible content is preserved when connection errors occur
- [ ] T022 [US2] Fix chat reducer `NO_ACTIVE_RUN` exhaustion to flush in `apps/web/components/session/chat-reducer.ts` — when `noRunRetries >= MAX_NO_RUN_RETRIES`, flush `streamingParts` before setting error state
- [ ] T023 [US2] Update stop handler in `apps/web/components/session/use-agent-chat.ts` — after calling `POST /stop`, do NOT immediately dispatch `FINISH_STREAMING`. Instead, let the SSE terminal event (`aborted` with `terminalReason: "stopped"`) drive the flush. Add a 10-second safety timeout that dispatches `FINISH_STREAMING` if no terminal event arrives
- [ ] T024 [US2] Use server-provided `assistantParts` as fallback in terminal event handling in `apps/web/components/session/chat-reducer.ts` — when a terminal `STREAM_EVENT` (`done`/`aborted`/`error`) carries `assistantParts` and the local `streamingParts` buffer is empty, use the server-provided parts for the flush instead
- [ ] T025 [P] [US2] Update stop endpoint response in `apps/web/app/api/sessions/[id]/stop/route.ts` — return `{ runId, acknowledged: true }` per contracts/api.md section 2
- [ ] T026 [P] [US2] Fix stale "abort signal not enforced" log in `packages/platform/src/services/session.ts` — remove or update the `logger.warn("session.stop.signal_not_enforced", ...)` message to reflect that the abort signal is now consumed by the worker
- [ ] T027 [P] [US2] Render `status: "interrupted"` on tool call parts in `apps/web/lib/ui/lib/chat-parts.ts` — when a tool_call part has `status: "interrupted"`, render an "Interrupted" badge/indicator in the UI
- [ ] T028 [P] [US2] Show `streamingParts` even when `isStreaming` is false in `apps/web/components/session/message-list/message-area.tsx` — remove the `isStreaming &&` guard on rendering `streamingParts`. Instead, always show them if `streamingParts.length > 0`, with appropriate styling based on `isStreaming` vs terminal

**Checkpoint**: Stop at any point during a turn preserves all visible content. Reload confirms.

---

## Phase 5: User Story 3 — The Agent Loop Never Silently Stops (Priority: P1)

**Goal**: Every loop exit is classified. Empty responses are retried. Truncated streams are detected. Transient errors are retried. No silent exits.

**Independent Test**: Force empty model response — verify retry then labeled failure. Force provider 429 — verify retry then eventual success/failure. Check step-limit — see "Continue" UI.

### Implementation for User Story 3

- [ ] T029 [US3] Add `terminationReason` to `AgentLoopResult` in `apps/agent/src/loop.ts` — extend the return type with `terminationReason: "end_turn" | "step_limit" | "empty_response" | "abort" | "max_tokens"`. Set the value at each `break` point: `end_turn` when text blocks exist, `empty_response` when no text and no tools, `step_limit` when `steps >= maxSteps`, `abort` when `shouldAbort` triggered
- [ ] T030 [US3] Add empty-response retry logic to `apps/agent/src/loop.ts` — when `toolUseBlocks.length === 0 && textBlocks.length === 0` (and content is only thinking blocks or empty), retry the LLM call up to 2 times within the same loop iteration. Publish a `{ type: "token", token: "" }` "thinking…" indicator before retry. If all retries produce empty output, set `terminationReason: "empty_response"` and break
- [ ] T031 [US3] Add transient LLM error retry with exponential backoff in `apps/agent/src/loop.ts` — wrap the `provider.chat()` call in a retry helper: max 3 attempts, backoff 1s/4s/16s, retry on rate-limit (429), 5xx, and network errors. Log retries via `recorder`. On exhaustion, throw a classified error distinguishing `provider_transient` from `provider_fatal`
- [ ] T032 [US3] Detect truncated streams and `max_tokens` in `apps/agent/src/llm/anthropic.ts` — when `stopReason` is `max_tokens`, flag the response so the loop can set `terminationReason: "max_tokens"`. When the stream ends without a `message_stop` event, flag as truncated
- [ ] T033 [P] [US3] Detect truncated streams and `max_tokens` in `apps/agent/src/llm/openai.ts` — when `finish_reason` is `length`, flag as `max_tokens`. When the stream ends without a `[DONE]` marker, flag as truncated
- [ ] T034 [US3] Map `terminationReason` to `terminal_reason` in `apps/agent/src/agent.ts` — after the `agentLoop` call, map the loop's `terminationReason` to the DB `terminal_reason` value and pass to `updateRunStatus`. Handle `empty_response` (set status `failed`), `max_tokens` (set status `completed`), etc.
- [ ] T035 [US3] Detect and handle `finish_reason: tool_use` with zero tool blocks in `apps/agent/src/loop.ts` — when `response.stopReason` indicates tool use but `toolUseBlocks` is empty, treat as `empty_response` (retry or classify)
- [ ] T036 [P] [US3] Render terminal-state badges in chat UI `apps/web/components/session/message-list/message-area.tsx` — render distinct visual badges for each `terminalReason` on the assistant turn: "Stopped", "Step limit reached", "Provider error", "Timed out", "Max tokens", "No response from model", etc. Per FR-024
- [ ] T037 [P] [US3] Handle `step_limit` terminal in `apps/web/components/session/chat-reducer.ts` — when `terminalReason === "step_limit"` on a `done` event, set a flag that tells the UI to show both a "Continue" button and the free-form input. Add `stepLimitReached: boolean` to `ChatState`

**Checkpoint**: No agent run can exit silently. Every exit produces a labeled terminal state visible in the UI.

---

## Phase 6: User Story 4 — Stop is Responsive During Long Tools (Priority: P2)

**Goal**: Stop interrupts in-flight tools within the published time bound, not just between LLM iterations

**Independent Test**: Agent calls a long `bash` command or `ask_user` wait. Click Stop. Run finalizes within 10 seconds.

### Implementation for User Story 4

- [ ] T038 [US4] Check abort signal during tool dispatch loop in `apps/agent/src/loop.ts` — after each tool execution completes (and before starting the next tool in a multi-tool step), check `signal.aborted`. If true, mark remaining queued tool calls as `status: "interrupted"` and break the tool dispatch loop
- [ ] T039 [US4] Add `AbortSignal` parameter to `AgentTool` interface and `tool-registry.ts` in `apps/agent/src/tool-registry.ts` — update `AgentTool.execute` signature to accept `{ signal?: AbortSignal }` as a third parameter. Thread the signal from `agentLoop` params through the tool dispatch
- [ ] T040 [P] [US4] Honor `AbortSignal` in `web-fetch` tool in `apps/agent/src/tools/web-fetch.ts` — pass the signal to the underlying `fetch()` call so HTTP requests are cancellable
- [ ] T041 [P] [US4] Honor `AbortSignal` in `glob` and `grep` tools in `apps/agent/src/tools/glob.ts` and `apps/agent/src/tools/grep.ts` — for sandbox adapter calls, pass abort signal if the adapter supports it; otherwise, check `signal.aborted` before returning results

**Checkpoint**: Stop during any long tool takes effect within seconds

---

## Phase 7: User Story 5 — Worker Crashes Don't Corrupt Conversations (Priority: P2)

**Goal**: Crash mid-turn either resumes or finalizes cleanly. No duplicate messages. No stuck runs.

**Independent Test**: Start run, kill worker, restart — run finalized within 90s, no duplicate messages, user can continue.

### Implementation for User Story 5

- [ ] T042 [US5] Add idempotency guard at the top of `runAgentTurn` in `apps/agent/src/agent.ts` — SELECT `agent_runs.status` before execution. If status is terminal, log skip and return immediately. If status is `running` AND a `chat_messages` row with matching `run_id` exists, log skip and return (prevents duplicate re-execution after crash + re-delivery)
- [ ] T043 [US5] Improve dead-letter finalization in `apps/agent/src/worker.ts` — when `finalizeDeadLetter` runs, set `terminal_reason = "worker_lost"` alongside `status = "error"`. Publish an `error` event with `terminalReason: "worker_lost"` so the UI shows a clear indicator. If an assistant message row exists for this `run_id`, update it to final state rather than leaving it orphaned
- [ ] T044 [US5] Add stale-run reaper to `apps/agent/src/worker.ts` — alongside the existing `reclaimStalePending` interval, add a periodic check (every 60s) for `agent_runs WHERE status = 'running' AND last_heartbeat_at < NOW() - INTERVAL '5 minutes'`. Finalize these as `status = 'error'`, `terminal_reason = 'worker_lost'`. Clear `chats.active_run_id`. Publish terminal events
- [ ] T045 [P] [US5] Ensure SIGTERM drain persists in-flight work in `apps/agent/src/worker.ts` — on SIGTERM, trigger the abort controller for any in-flight run so the normal abort → persist path executes before the process exits

**Checkpoint**: Worker crashes and restarts don't leave corrupted or stuck conversations

---

## Phase 8: User Story 6 — Authoritative UI State (Priority: P2)

**Goal**: What the UI shows matches what's durably stored. No optimistic-only content that vanishes on reload.

**Independent Test**: Multi-tab scenario. Stop during stream, stop before terminal event, network drop. Reload always matches stored state.

### Implementation for User Story 6

- [ ] T046 [US6] Deduplicate stream events against DB-loaded messages in `apps/web/components/session/use-agent-chat.ts` — on SSE reconnect (when `initialMessages` already contain assistant parts from the DB), build a set of `toolCallId` values from DB messages. In the `STREAM_EVENT` handler, skip events whose `toolCallId` is already in the set. Use `_seqCounter` for text part dedup
- [ ] T047 [US6] Load latest run's `terminal_reason` and `status` for terminal badge on reload in `apps/web/app/(authenticated)/sessions/[id]/page.tsx` — when the latest `agent_runs` row has a terminal status, pass `terminalReason` and `status` to the chat component so it renders the appropriate badge without needing SSE
- [ ] T048 [P] [US6] Add `POST /api/sessions/:id/continue` endpoint in `apps/web/app/api/sessions/[id]/continue/route.ts` — validate latest run's `terminal_reason === "step_limit"`, create new `agent_runs` row, enqueue job with prior `modelMessages` context, set `chats.activeRunId`, return `{ runId, sessionId }`
- [ ] T049 [P] [US6] Add `continue()` method to `SessionService` in `packages/platform/src/services/session.ts` — implement the continue logic: find latest run, validate step_limit, find assistant message with that run_id, extract `modelMessages`, create new run + enqueue. Called by both web API and gateway
- [ ] T050 [P] [US6] Add `/continue` route to gateway in `apps/gateway/src/routes/sessions.ts` — mirror the web API `continue` endpoint, calling `sessions.continue()` from the platform service
- [ ] T051 [US6] Render "Continue" button + free-form input on `step_limit` in `apps/web/components/session/message-list/message-area.tsx` — when `stepLimitReached` is true in `ChatState`, show a "Continue" button that calls `POST /continue` and a standard message input. On continue click, dispatch `START_STREAMING` with the new `runId`

**Checkpoint**: UI always shows authoritative, durable state. Continue from step-limit works.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Cleanup, consistency, and operational improvements across all stories

- [ ] T052 [P] Add `terminalReason` to synthetic terminal events in `apps/gateway/src/routes/stream.ts` — when the SSE endpoint synthesizes a terminal event (e.g., run finished before client connected), include the `terminal_reason` from the `agent_runs` row or the Redis status cache
- [ ] T053 [P] Handle `heartbeat` events in SSE replay in `apps/gateway/src/routes/stream.ts` — include heartbeat events during XRANGE replay so reconnecting clients get a liveness signal immediately
- [ ] T054 Remove publish-error swallowing in `packages/platform/src/events/run-stream.ts` — when `XADD` fails, instead of silently returning, throw a `RedisStreamError` so the caller can decide to degrade gracefully (FR-010). Update callers in `run-persistence.ts` to catch and log but still persist to DB
- [ ] T055 [P] Add observability counters for terminal reasons in `apps/agent/src/observability.ts` — emit a structured log event for each terminal reason at run end. This enables `SC-005` and `SC-010` measurement via log queries
- [ ] T056 Ensure `publishEvent` for tokens is resilient in `apps/agent/src/agent.ts` — the existing `.catch()` on token publishing is fine for non-critical tokens; verify it doesn't mask errors for critical events (tool_call, tool_result). Critical event publish failures should log at `error` level, not `warn`
- [ ] T057 Run quickstart.md validation — execute the test scenarios from `specs/003-agent-loop-hardening/quickstart.md` end-to-end to confirm all user stories work as specified

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phases 3-8 (User Stories)**: All depend on Phase 2 completion
  - **US1 (Phase 3)** can start immediately after Phase 2
  - **US2 (Phase 4)** can start immediately after Phase 2 (independent of US1)
  - **US3 (Phase 5)** can start immediately after Phase 2 (independent of US1/US2)
  - **US4 (Phase 6)** depends on US2 (builds on abort signal infrastructure wired in US2)
  - **US5 (Phase 7)** can start immediately after Phase 2 (independent)
  - **US6 (Phase 8)** depends on US1 (uses incremental persistence) + US3 (uses terminal reasons)
- **Phase 9 (Polish)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (Reload durability)**: After Phase 2 — no dependencies on other stories
- **US2 (Stop preserves work)**: After Phase 2 — no dependencies on other stories
- **US3 (No silent stops)**: After Phase 2 — no dependencies on other stories
- **US4 (Stop during tools)**: After US2 (reuses the abort signal wiring from US2)
- **US5 (Worker crash safety)**: After Phase 2 — no dependencies on other stories
- **US6 (Authoritative UI)**: After US1 + US3 (uses incremental persistence + terminal reasons)

### Within Each User Story

- Backend changes before frontend changes
- Persistence/loop changes before UI rendering changes
- Core logic before edge-case handling

### Parallel Opportunities

- T003 and T004 (types) can run in parallel within Phase 1
- T005, T006, T007, T008 are sequential within Phase 2 (T006/T007 can parallel)
- US1, US2, US3, US5 can all start in parallel after Phase 2
- Within US2: T025, T026, T027, T028 are all parallelizable (different files)
- Within US3: T032/T033 (Anthropic/OpenAI) are parallelizable; T036/T037 are parallelizable
- Within US5: T045 is parallelizable with T042-T044
- Within US6: T048/T049/T050 (continue endpoint) are parallelizable across web/platform/gateway

---

## Parallel Example: User Story 2 (Stop)

```bash
# Backend abort wiring (sequential — T016 first, then T017, T018, T019):
Task T016: Wire merged abort controller in agent.ts
Task T017: Pass AbortSignal to tools in loop.ts
Task T018: Honor AbortSignal in ask_user tool
Task T019: Honor AbortSignal in bash tool

# Frontend fixes (parallel — different files):
Task T020: Fix FINISH_STREAMING guard in chat-reducer.ts
Task T025: Update stop endpoint response in stop/route.ts
Task T026: Fix stale log in session.ts
Task T027: Render interrupted status in chat-parts.ts
Task T028: Show streaming parts when not streaming in message-area.tsx
```

---

## Parallel Example: User Story 6 (Authoritative UI)

```bash
# Continue endpoint (parallel — different apps):
Task T048: Web API continue route
Task T049: Platform session.continue() method
Task T050: Gateway continue route

# These three can develop simultaneously against the contract spec
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 + 3)

1. Complete Phase 1: Setup (4 tasks)
2. Complete Phase 2: Foundational (4 tasks)
3. Complete Phase 3: US1 — Reload durability (7 tasks)
4. Complete Phase 4: US2 — Stop preserves work (13 tasks)
5. Complete Phase 5: US3 — No silent stops (9 tasks)
6. **STOP and VALIDATE**: Test all three P1 stories independently
7. Deploy and observe for the three reported symptoms

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Test reload mid-turn → Deploy (addresses symptom 3)
3. US2 → Test stop preserves → Deploy (addresses symptom 2)
4. US3 → Test no silent stops → Deploy (addresses symptom 1)
5. US4 → Test stop during tools → Deploy (improves stop responsiveness)
6. US5 → Test worker crash → Deploy (production hardening)
7. US6 → Test authoritative UI + continue → Deploy (full reliability)
8. Polish → Final cleanup → Deploy

### Parallel Strategy

With capacity for parallel work:
1. Team completes Phase 1 + Phase 2 together
2. Once Phase 2 is done:
   - Stream A: US1 (reload) + US6 (authoritative UI, after US1)
   - Stream B: US2 (stop) + US4 (stop during tools, after US2)
   - Stream C: US3 (no silent stops) + US5 (worker crash)
3. Polish phase after all stories complete

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable after Phase 2
- **US1+US2+US3 are the MVP** — they directly address the three reported symptoms
- US4+US5+US6 are P2 hardening that builds on the P1 foundation
- The total scope is 57 tasks across 9 phases
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently

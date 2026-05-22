# Feature Specification: Agent Loop & Chat Reliability Hardening

**Feature Branch**: `003-agent-loop-hardening`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "Audit the agent loop and chat end-to-end. Symptoms today: (1) agent calls many tools, then quietly stops with no next tool call and no final message; (2) clicking Stop discards in-progress tool calls and assistant messages from the conversation; (3) reloading the page erases agent messages and tool results that were previously visible. Identify root causes of fragility and define the refactors and behaviors required to make conversations durable, the loop robust, and stop/resume predictable."

## Context: Why This Spec Exists

This is a **reliability hardening** effort, not a net-new feature. An audit of the current implementation surfaced a common root cause across all three reported symptoms: **the agent's work-in-progress (streaming text, tool calls, tool results) is held in ephemeral state (in-memory client buffers and a best-effort Redis stream) and is only committed durably at the very end of a turn.** Any disruption between "first token" and "turn complete" — a stop click, a page reload, a silent loop exit, a transient network error, a worker restart — discards visible work and leaves the conversation in a confusing state.

The spec below describes the *behavior* the platform must guarantee. Implementation choices (tables, streams, transactions, etc.) are owned by the planning phase.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Conversation Survives Page Reload (Priority: P1)

A user sends a message to the agent. The agent begins responding: it streams thinking, calls several tools, and renders tool results inline. Mid-turn, the user accidentally closes the browser, refreshes the tab, or navigates away and returns. When the conversation re-opens, the user sees the same content they saw before — every assistant message, every tool call, every tool result, in the same order — and, if the run is still in progress, streaming resumes seamlessly from where it left off.

**Why this priority**: This is the most damaging current failure. Losing committed-looking conversation on reload destroys user trust, makes long agent runs unusable, and erases context the user is relying on to make decisions. Without durability, no other improvement matters.

**Independent Test**: Start a long-running agent turn. After at least one tool call has rendered, hard-reload the page (a) while the run is still active, and (b) after the run has completed. In both cases, the chat shows every message and tool call previously visible, in order, with results intact. In case (a), streaming continues for any further work the agent produces.

**Acceptance Scenarios**:

1. **Given** an agent has streamed three tool calls and a partial assistant text block, **When** the user reloads the page, **Then** all three tool calls and the partial text are present in the conversation, in original order, with full content.
2. **Given** an agent turn is still in progress, **When** the user reloads, **Then** previously-rendered content is restored from durable storage and the live stream re-attaches so subsequent tool calls and tokens continue to appear without duplication or gaps.
3. **Given** an agent turn completed normally before reload, **When** the user reloads, **Then** the final assistant message and all tool calls/results are present exactly as they appeared at turn end.
4. **Given** an agent turn was aborted, errored, or timed out, **When** the user reloads, **Then** the conversation shows every assistant chunk and tool call that the user saw before the disruption, plus a clear, persistent terminal-status indicator (e.g., "stopped", "failed", "timed out") attached to that turn.

---

### User Story 2 - Stop Preserves In-Progress Work (Priority: P1)

A user sends a request, watches the agent work for a while, then decides the agent is going down the wrong path and clicks **Stop**. Within a short, predictable time the agent stops doing new work. Everything the user already saw — every tool call, every tool result, every word of assistant text — remains in the conversation, marked as belonging to a stopped turn. The user can then send a follow-up message that builds on that partial work.

**Why this priority**: Stop is the user's primary lever to control cost and direction. If Stop destroys the visible record of what was done, the user loses context for their correction, can't reference what already happened, and is punished for using the control.

**Independent Test**: While an agent run is mid-flight (after at least one tool result has rendered and an assistant text fragment is visible), click Stop. Verify (i) the agent ceases new work within a defined timeout, (ii) every previously-visible message, tool call, and tool result remains in the conversation, (iii) the stopped turn carries a clear "stopped" marker, and (iv) a follow-up message from the user works normally and has the stopped turn in its context.

**Acceptance Scenarios**:

1. **Given** the agent is in the middle of streaming assistant text, **When** the user clicks Stop, **Then** the text already streamed is preserved in the conversation and the turn is marked stopped.
2. **Given** the agent has issued a tool call whose result has already returned, **When** the user clicks Stop, **Then** both the call and its result are preserved in the conversation.
3. **Given** the agent has issued a tool call that has not yet returned, **When** the user clicks Stop, **Then** the call is preserved with a clear "interrupted" status, and the tool's side effects (if any) are not silently rolled back beyond what the tool itself controls.
4. **Given** a user has clicked Stop and the turn has been finalized, **When** the user reloads the page, **Then** the same preserved content and "stopped" indicator appear.
5. **Given** Stop is clicked, **When** measured from the click, **Then** new tool calls cease within a published bound (target: see SC-002) and the conversation reaches its terminal "stopped" state within a second published bound (target: see SC-003).

---

### User Story 3 - The Agent Loop Never Silently Stops (Priority: P1)

A user sends a request. The agent makes progress for a while, then reaches an internal condition that, today, causes it to quietly exit (a thinking-only model response, a truncated stream from the provider, a transient rate-limit, a maximum-step cap hit, a publish error). Rather than going dark, the agent does exactly one of three observable things: (a) automatically recovers and continues, (b) reaches a normal end-of-turn with a final assistant message, or (c) ends in a clearly-labeled non-success terminal state (e.g., "step limit reached", "provider unavailable", "max tokens reached, continuation needed") that the user can see and act on.

**Why this priority**: "Just stops" with no signal is the worst possible UX — the user can't tell whether to wait, retry, or rephrase. Every loop exit must be classified and surfaced.

**Independent Test**: Force the agent into each known silent-exit condition (e.g., a model response with no tool use and no text, a step-limit hit, a simulated transient provider error). Verify that in no case does the conversation simply stop with no indicator. Every termination produces either a recovery, a final message, or a labeled terminal state visible in the UI and in stored history.

**Acceptance Scenarios**:

1. **Given** the model returns a response with no actionable content (no text, no tool calls), **When** the loop processes that response, **Then** the loop either continues with a re-prompt or terminates with a labeled status; it never exits as a normal completion.
2. **Given** the model's stream is truncated due to network or provider issues, **When** the loop detects the truncation, **Then** the run is retried up to a published retry budget, after which it terminates with a labeled non-success status.
3. **Given** the loop has reached its configured maximum step count, **When** the limit is hit, **Then** the conversation shows a clear "step limit reached" marker and offers an explicit user action to continue.
4. **Given** the provider returns a transient error (rate limit, 5xx), **When** the loop receives it, **Then** the system retries with backoff up to a published budget before classifying the run as failed.
5. **Given** an event-publish failure occurs (the live stream channel rejects a write), **When** detected, **Then** the loop does not silently continue with a degraded UI; it either recovers the publish via durable storage or marks the run as degraded so the UI reflects the gap.
6. **Given** any exception is raised inside the agent loop, **When** it propagates out of an iteration, **Then** it is recorded against the run with a classification (transient, provider, tool, internal) and produces a terminal event the UI can render.

---

### User Story 4 - Stop is Responsive Even During Long Tools (Priority: P2)

A user clicks Stop while the agent is in the middle of a long-running tool (a long-running shell command, a network fetch, a "wait for user reply" tool). Stop takes effect promptly: the in-flight tool is asked to cancel, the loop does not wait for it to complete naturally before honoring the stop, and the conversation transitions to its "stopped" terminal state within the published time bound.

**Why this priority**: Today, Stop is only checked between LLM iterations. Long tools defeat Stop. This is a high-impact UX issue but logically follows P1 stop semantics.

**Independent Test**: Trigger the agent to call a long-running tool (e.g., a sleep, a slow command, or the wait-for-user tool). Click Stop. Verify the conversation reaches "stopped" state within the published bound regardless of the tool's natural runtime.

**Acceptance Scenarios**:

1. **Given** a tool that supports cooperative cancellation is running, **When** the user clicks Stop, **Then** the tool is signaled to cancel and the run terminates within the published bound.
2. **Given** a tool that does not support cancellation is running, **When** the user clicks Stop, **Then** the loop abandons waiting on it, records the call as "interrupted", and finalizes the run within the published bound; any later-arriving result is discarded or recorded out-of-band but does not corrupt the stopped turn.
3. **Given** the agent is waiting on a `ask_user`-style interactive tool, **When** Stop is clicked, **Then** the wait is interrupted, the call is marked interrupted, and the turn finalizes.

---

### User Story 5 - Worker Crashes Don't Corrupt Conversations (Priority: P2)

If the process executing an agent run crashes, restarts, or is preempted mid-turn, the platform either resumes the turn cleanly or finalizes it with a clear, non-corrupting terminal status. The conversation is never left "stuck" in an in-flight state forever, and re-processing the same job never produces duplicate assistant messages or duplicate tool side-effects in storage.

**Why this priority**: Critical for production reliability but observable only on infrastructure events; users tolerate occasional restarts more than they tolerate visible UI loss.

**Independent Test**: Start an agent run, kill the worker process mid-turn, restart it. Verify the run either (a) resumes from a checkpoint, or (b) is finalized with a "failed/interrupted" status within a bounded recovery window; verify no duplicate assistant messages exist in storage; verify the user can send a follow-up without manual cleanup.

**Acceptance Scenarios**:

1. **Given** an agent run is in flight, **When** the worker crashes, **Then** the run is automatically recovered or finalized to a terminal state within the published recovery window.
2. **Given** a job has produced a fully-persisted assistant turn, **When** the same job is retried (e.g., due to ack failure), **Then** no duplicate assistant message is created and no tool with persistent side-effects is re-executed in a way that produces user-visible duplication.
3. **Given** a run is "stuck" (heartbeat lost, no terminal event), **When** the recovery window elapses, **Then** the system finalizes it as "interrupted" and clears any references that block the user from continuing the conversation.

---

### User Story 6 - The Conversation Shows Authoritative State, Not Optimistic Guesses (Priority: P2)

What the user sees in the chat matches what is durably stored. The UI does not render content that is unrecoverable on reload (other than ephemeral typing/streaming indicators while a run is active). When the user sees a tool call result, that result is in durable storage; when the UI shows "stopped", the stored state agrees. The user cannot end up in a state where the screen and the database disagree about what the agent has done.

**Why this priority**: Underpins trust in all three P1 stories. Best handled in concert with them.

**Independent Test**: Run several adversarial scenarios (stop during stream, stop just before terminal event, network drop mid-stream, two browser tabs of the same session). After each, compare what is displayed to what loads on fresh reload. The two must match.

**Acceptance Scenarios**:

1. **Given** the UI shows a tool call with a result, **When** the user reloads, **Then** the same tool call and result load from storage.
2. **Given** two browser tabs are viewing the same session, **When** an event occurs in one, **Then** the other reflects it within a published bound and both agree with storage on reload.
3. **Given** an event arrives at the UI but durable persistence has not yet completed, **Then** the UI either waits to display until durable, or displays it with a clear "pending" indicator that resolves on persistence.

---

### Edge Cases

- **Two concurrent runs for the same chat**: a user sends a second message while the first run is still streaming. The platform must define which run "wins" and ensure no message or tool result is dropped from either as a side-effect of the transition.
- **Stop pressed twice / Stop pressed after run is already terminal**: must be idempotent and produce the same observable end state.
- **Stop pressed while a user-reply (`ask_user`) is pending**: pending wait must be cancellable; any later user reply must not be silently applied to a stopped run.
- **Model response that contains only internal "thinking" with no text and no tool calls**: must not be treated as a normal end-of-turn; either re-prompt or label terminal.
- **Provider returns `finish_reason: tool_use` but the parsed content has zero tool blocks**: must be recognized as an anomaly, retried or labeled.
- **Token-streaming dropouts**: missed live events must be backfillable from durable storage so the UI never has a silent gap.
- **Very long turns** (more tool events than the live channel can retain in its buffer): durable storage must serve as the source of truth for any UI scroll-back or replay.
- **Multi-tab usage**: stop, reload, and live updates must be consistent across tabs.
- **Auto-title, spec, review, and other secondary triggers** that enqueue runs: must obey the same durability and termination guarantees.
- **Replay/idempotency**: if a queued job is delivered twice, the second delivery must not produce visible duplicates or re-run tools whose side-effects already occurred.

## Requirements *(mandatory)*

### Functional Requirements

**Durability of conversation content**

- **FR-001**: Every assistant text fragment, tool call, and tool result that has been *successfully delivered to the user's screen* MUST be durably persisted within a bounded interval (see SC-004), such that a page reload restores it identically.
- **FR-002**: A turn that ends in any non-success state (stopped, failed, timed-out, interrupted, step-limit reached, provider-error) MUST persist all content it produced up to that point, in original order, and MUST persist a terminal status indicator on the turn.
- **FR-003**: The persisted conversation MUST be the authoritative source for chat rendering on load and on reconnect. Reload MUST NOT depend on ephemeral storage (in-memory caches, expiring live-event channels) being available.
- **FR-004**: When a run is still in progress at reload time, the UI MUST be able to reattach to the live event flow without producing duplicate or out-of-order events relative to what was already loaded from durable storage.

**Loop termination integrity**

- **FR-005**: Every exit path from the agent loop MUST classify the exit into a finite, documented set of terminal states (e.g., completed, stopped, failed-transient, failed-internal, failed-provider, step-limit, max-tokens, no-actionable-output, timeout, interrupted-by-restart). No silent or unlabeled exit is permitted.
- **FR-006**: A model response that contains neither user-visible text nor a tool call MUST NOT be treated as a normal completion. The platform MUST silently re-prompt the model (up to 2 retries) with a "thinking…" indicator visible to the user. Only if all retries produce empty output MUST the run terminate with a labeled non-success state.
- **FR-007**: A truncated provider stream, a parse failure, or a `finish_reason` that conflicts with parsed content MUST be detected and produce a retry or a labeled terminal state — never a silent normal completion.
- **FR-008**: Transient provider errors (rate limits, 5xx, network resets) MUST be retried with exponential backoff up to a bounded budget before being classified as failed.
- **FR-009**: The maximum-step-limit termination MUST surface a user-visible "step limit reached" marker and offer both a one-click "Continue" button (extends the step budget for the same turn) and a free-form input (starts a new turn). The default step limit SHOULD be set high to favor maximum agent autonomy.
- **FR-010**: Any exception raised inside the loop or its tool dispatch MUST be caught, classified (transient / provider / tool / internal), recorded against the run, and produce a terminal event for the UI. No exception may cause the loop to exit without finalization.

**Stop semantics**

- **FR-011**: When the user requests stop, the system MUST cease starting new model calls within a published time bound (see SC-002).
- **FR-012**: Stop MUST immediately cancel the in-flight model stream and signal in-flight tools to cancel. Only the currently-active tool call or LLM call is marked "interrupted"; all previously-completed work is persisted normally. The interrupted partial content MUST be persisted and included in the LLM context when the user sends a follow-up message.
- **FR-013**: Stop MUST preserve all content that was already visible (or that arrives before the published cancellation deadline) and persist it as the content of a turn whose terminal state is "stopped".
- **FR-014**: Stop MUST be idempotent: repeated stop signals on the same run produce the same observable terminal state.
- **FR-015**: After Stop has finalized a turn, any later-arriving partial result from a tool or model stream MUST NOT mutate the stopped turn's stored content, but MUST be recorded out-of-band for diagnostic purposes.
- **FR-016**: Interactive waits (e.g., wait-for-user-reply) MUST be interruptible by Stop within the same time bound as other in-flight work.

**Resumability & idempotency**

- **FR-017**: If a worker process executing a run is lost (crash, restart, deployment), the platform MUST detect the loss within a published recovery window and either (a) resume the run from its last durable checkpoint or (b) finalize it with a clear "interrupted" terminal state.
- **FR-018**: A job whose run already reached a terminal state MUST NOT execute again on retry; retries of already-terminal runs MUST be a no-op with respect to user-visible state and tool side-effects.
- **FR-019**: Persisting an assistant turn MUST be idempotent against re-delivery: the same logical turn delivered twice must not produce two assistant entries in the conversation.
- **FR-020**: The platform MUST NOT permit a chat to remain in an "in-flight" state indefinitely. A run with no progress within a published staleness threshold MUST be finalized as "interrupted" automatically.

**State consistency across UI and storage**

- **FR-021**: The chat UI MUST NOT render content that is not durably recoverable on reload, with the sole exception of ephemeral typing/streaming indicators tied to an active run.
- **FR-022**: When durable persistence of an event is in progress, the UI MAY display the event with a clear "pending" indicator that resolves once persistence completes; otherwise, the UI MUST wait until the event is durable to render it as final.
- **FR-023**: Multi-tab and reload consistency: clients viewing the same session MUST converge on the same conversation state within a published bound, and MUST agree with durable storage on reload.
- **FR-024**: Terminal status of a turn (completed, stopped, failed-*, interrupted, step-limit, max-tokens, no-actionable-output, timeout) MUST be visually distinguishable and persistently attached to the turn, both live and on reload.

**Observability of run health**

- **FR-025**: For every in-flight run the platform MUST surface a liveness signal that allows the UI (and operators) to detect when no progress has occurred for longer than a published threshold.
- **FR-026**: Every terminal state of a run MUST be queryable through a single canonical source so the UI, operators, and follow-up runs all read the same answer.
- **FR-027**: Loop exits, retries, classifications, and recovery actions MUST be recorded with enough detail to reconstruct what happened on any single run for support and debugging.

### Key Entities

- **Chat session**: the user-facing conversation. Tracks which run, if any, is currently active.
- **Run (turn execution)**: a single execution of the agent loop in response to a user input. Tracks lifecycle (queued → running → terminal), terminal classification, retry count, and timing.
- **Assistant turn content**: the ordered list of text fragments, tool calls, and tool results produced during one run. Stored durably and serves as the chat-render source of truth.
- **Tool call**: a single tool invocation within a turn, with name, arguments, status (pending / completed / interrupted / failed), and result if any.
- **Live event channel**: a transient transport for streaming progress to connected clients. Sources from durable storage on replay/reconnect rather than being authoritative itself.
- **Run liveness signal**: a heartbeat or progress indicator that lets the platform detect stalled runs.
- **Terminal classification**: the finite, documented set of run end-states (and the metadata each carries) that drives both UI presentation and recovery policy.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001 (Reload durability, primary)**: In 99% or more of agent turns, every assistant text fragment, tool call, and tool result that was rendered to the user is present in the conversation after a hard page reload, in original order, with intact content.
- **SC-002 (Stop responsiveness)**: After a user clicks Stop, no new model calls or tool invocations start more than 5 seconds later in 99% of cases.
- **SC-003 (Stop finalization)**: After a user clicks Stop, the conversation reaches its terminal "stopped" display state — with all previously visible work preserved — within 10 seconds in 99% of cases.
- **SC-004 (Persistence latency)**: 99% of events that the user sees on screen are durable in storage within 2 seconds of being shown, measured end-to-end from event production to durable commit.
- **SC-005 (No silent stops)**: 100% of agent runs end in a labeled terminal state (one of the documented classifications). The rate of runs that finish without producing either a final assistant message or a labeled non-success terminal indicator is zero.
- **SC-006 (Recovery from worker loss)**: When a worker process is lost mid-run, 99% of affected runs reach a terminal state (either resumed-complete or labeled-interrupted) within 90 seconds, with no duplicate assistant messages or duplicate user-visible tool effects on resume.
- **SC-007 (Multi-tab and reconnect consistency)**: When the same conversation is viewed in two clients, both display the same content within 2 seconds of any new event in 99% of cases, and both agree with storage on fresh reload.
- **SC-008 (No stuck conversations)**: The fraction of conversations whose run remains in a non-terminal "running" state for longer than 5 minutes without observable progress is below 0.1%.
- **SC-009 (Transient-error resilience)**: Of runs that encounter at least one transient provider error, 95% complete successfully (after automated retry) without user intervention.
- **SC-010 (User-perceived reliability)**: User-reported incidents matching the three reported symptoms (silent stop, stop loses content, reload loses content) drop to near zero, as measured by support reports and observability counters over a 30-day window post-launch.

## Assumptions

- The existing job queue, durable database, and live-event transport are appropriate substrates; this work hardens behavior around them rather than replacing them.
- Tool side-effects that are observable outside the platform (e.g., changes to a remote repository) are governed by the tools themselves; this spec does not require platform-level reversal of external side-effects when Stop is pressed.
- "Mid-step" durable checkpoints occur at natural boundaries that the platform controls — at least at the level of completed model responses and completed tool results — and not necessarily at the individual-token level. Token-level durability is desirable for UI fidelity but is not required by this spec beyond what SC-001 and SC-004 imply.
- "Silent stop" recovery prefers automatic continuation when safe (e.g., re-prompting after an empty model response within retry budget) over surfacing every internal anomaly to the user.
- The UI rendering rules apply consistently to all session-level chats; this spec does not introduce per-chat configurable durability.
- Workers can be horizontally scaled; idempotency must hold under at-least-once delivery semantics.
- Observability event tables remain a separate, ops-facing log; they do not become the chat-rendering source of truth. Chat rendering is served by chat-domain durable storage.
- This work intends to obsolete several pieces of fragile behavior identified in the audit (e.g., the conditional "show streaming buffer only while streaming" rule, the practice of clearing live-event references before terminal persistence, the swallowing of publish errors). The planning phase will inventory and either delete or rebuild those pieces.

## Clarifications

### Session 2026-05-21

- Q: Stop policy — graceful-finish-current-step vs. hard-interrupt-current-step? → A: **Immediate interrupt**. Cancel the in-flight LLM stream and signal tools to cancel immediately. Only the *currently active* tool call and/or LLM call is marked "interrupted" in the UI; all previously-completed tool calls and text are persisted normally. Interrupted partial results are still persisted and fed into the LLM when the conversation continues, matching Cursor's behavior.
- Q: Silent-retry-with-budget vs. user-visible-pause-affordance for empty model responses? → A: **Silent auto-retry with budget**. Re-prompt the model up to 2 times with a "thinking…" indicator. Surface a labeled terminal state only if all retries produce empty output.
- Q: One-click continue vs. require new user message at step-limit? → A: **Both** (option C). Present a "Continue" button that extends the step budget for the same turn *and* a free-form input that starts a new turn. The step limit should be set very high — the design favors maximum agent autonomy.

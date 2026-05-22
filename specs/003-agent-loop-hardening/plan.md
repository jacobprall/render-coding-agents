# Implementation Plan: Agent Loop & Chat Reliability Hardening

**Branch**: `003-agent-loop-hardening` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-agent-loop-hardening/spec.md`

## Summary

The agent loop and chat system suffer from a single architectural deficiency: **assistant content only reaches durable storage at the end of a turn.** This causes three visible failures — silent loop exits, Stop deleting visible content, and reload losing messages. The fix is a coordinated set of changes across the agent worker, persistence layer, chat UI state machine, and SSE reconnect logic that together achieve incremental persistence, proper abort wiring, classified terminal states, and resilient state reconciliation. The goal throughout is to leave every abstraction touched simpler, more reliable, and better-separated than before.

## Technical Context

**Language/Version**: TypeScript (Bun runtime)

**Primary Dependencies**: Next.js 15 (App Router), Hono (gateway), Drizzle ORM, ioredis, @ai-sdk/anthropic, @ai-sdk/openai

**Storage**: PostgreSQL 16 (Drizzle), Redis Streams + Pub/Sub

**Testing**: `bun test` (integration-focused per constitution)

**Target Platform**: Linux server (Render), web browser (Next.js SSR + client)

**Project Type**: Monorepo web platform (apps/web + apps/agent + apps/gateway + packages/*)

**Performance Goals**: SC-002 (Stop within 5s), SC-004 (persistence within 2s of display), SC-008 (no stuck runs >5min)

**Constraints**: At-least-once job delivery, multi-worker horizontal scaling, SSE-based streaming

**Scale/Scope**: Single-user to small-team usage; ~100 concurrent sessions target

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Simplicity** | PASS | No new tables; 3 nullable columns added to existing tables. Upsert pattern reuses existing `chat_messages` schema. No new frameworks or dependencies. |
| **II. Observability** | PASS | All terminal exits classified and logged. Heartbeat events visible in SSE stream. `terminal_reason` queryable on `agent_runs`. |
| **III. Modularity** | PASS | Changes span `apps/agent`, `packages/db`, `packages/platform`, `apps/web` — all within existing package boundaries. No new packages. |
| **IV. API-First** | PASS | New `POST /continue` endpoint available to both web and gateway consumers. SSE event additions are backward-compatible. |
| **V. Reliability** | PASS | This is the primary focus. Incremental persistence, idempotency guard, abort wiring, stale-run recovery. |
| **VI. Security** | PASS | No new auth surfaces. Continue endpoint requires same session auth as existing endpoints. |
| **VII. Testing** | PASS | Test strategy covers happy path, stop, reload, provider errors, worker crash, idempotency. |
| **VIII. OSS-Friendly** | PASS | No new env vars required. Existing `MAX_AGENT_STEPS` and `TURN_TIMEOUT_MS` remain. |
| **IX. Performance** | PASS | Incremental DB writes add one UPDATE per step (~0.5-5s interval). Heartbeat is one XADD per 15s. Both are negligible vs LLM call latency. |

**Post-design re-check**: PASS. No violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/003-agent-loop-hardening/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research decisions
├── data-model.md        # Phase 1: schema changes
├── quickstart.md        # Phase 1: developer onboarding
├── contracts/
│   └── api.md           # Phase 1: API contract changes
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
apps/agent/src/
├── loop.ts              # Core agent loop — add retry, termination reasons, per-tool abort
├── agent.ts             # Turn orchestration — incremental persist, merged abort, heartbeat
├── run-persistence.ts   # DB writes — upsert, terminal_reason, heartbeat updates
├── worker.ts            # Job consumer — idempotency guard, dead-letter improvements
├── llm/anthropic.ts     # Truncation detection, max_tokens surfacing
├── llm/openai.ts        # Truncation detection, max_tokens surfacing
└── types.ts             # StreamEvent type additions

packages/db/schema/
└── session.ts           # Add run_id, terminal_reason, last_heartbeat_at columns

packages/platform/src/
├── services/session.ts  # Fix stale log, add continue() method
└── state-machine.ts     # TerminalReason type export

apps/web/
├── components/session/
│   ├── chat-reducer.ts  # Fix flush guards, terminal fallback, status rendering
│   ├── use-agent-chat.ts # Stop waits for terminal event, not optimistic flush
│   └── message-list/
│       └── message-area.tsx  # Show streaming parts on non-streaming status
├── app/(authenticated)/sessions/[id]/page.tsx  # Unchanged (benefits from incremental persist)
├── app/api/sessions/[id]/
│   ├── stop/route.ts    # Enhanced response shape
│   └── continue/route.ts  # NEW: step-limit continuation
└── lib/ui/lib/chat-parts.ts  # Handle new event types, interrupted status

apps/web/lib/db/migrations/
└── 0006_agent_loop_hardening.sql  # Schema additions

apps/gateway/src/routes/
├── stream.ts            # Heartbeat in replay, terminalReason on synthetic events
└── sessions.ts          # Add /continue route
```

**Structure Decision**: This work modifies files across the existing monorepo packages. No new packages, no new apps, no new directory trees. The change set spans agent → platform → db → web in the natural dependency order.

## Design: Leaving Things Better

The audit revealed several areas where the current design can be simplified and made more robust as part of this work. These are not just bug fixes — they are opportunities to improve the architecture.

### 1. Persistence model: batch-at-end → incremental upsert

**Before**: `persistAssistantMessage` is a single INSERT at turn end. If anything goes wrong before that point, all assistant content is lost.

**After**: The same `chat_messages` row is created on the first step and updated on each subsequent step. The function becomes `upsertAssistantMessage(db, job, parts, modelMessages)`. This is simpler to reason about: the row always reflects the latest persisted state, and every error path inherits the same content the happy path wrote.

**Why better**: Eliminates the entire class of "content lost because persist didn't run" bugs. Removes the need for separate abort-persist, timeout-persist, error-persist paths — they all write the same way.

### 2. Abort model: polled-between-steps → signal-driven

**Before**: `shouldAbort()` checks a Redis flag at the top of each loop iteration only. The `abortController` is only tied to the turn timeout. Tools receive no abort signal. Stop during long tools is unresponsive.

**After**: A merged `AbortController` fires on either timeout or user stop (polled at 500ms). The signal is passed to both `provider.chat()` and `tool.execute()`. The `shouldAbort` callback in the loop still exists (for the "between-steps" check) but is now redundant with the signal — kept only as a belt-and-suspenders.

**Why better**: One abort mechanism (signal) instead of two competing ones (signal for timeout, flag for stop). Tools can optionally honor cancellation. The abort log message is fixed to reflect reality.

### 3. Chat reducer: conditional flush → unconditional flush

**Before**: `FINISH_STREAMING` only works when `status === "streaming"`. `SET_ERROR` doesn't flush. `NO_ACTIVE_RUN` exhaustion doesn't flush. Multiple paths discard the streaming buffer.

**After**: Any transition to a terminal state (`done`, `error`) always flushes `streamingParts` into `messages`. The status guard is removed. Terminal SSE events carrying `assistantParts` from the server are used as a fallback when the local buffer is empty (covers missed events). The reducer becomes a straightforward state machine where terminal = flush + classify.

**Why better**: One rule instead of six special cases. Content is never silently discarded from the UI.

### 4. Loop termination: implicit break → classified exit

**Before**: The loop has one explicit `break` (no tool use blocks) that handles both "model said goodbye" and "model returned garbage." The `hitStepLimit` flag is the only classification.

**After**: Every exit carries a `terminationReason`. Empty/thinking-only responses are retried before being classified. Truncated streams are detected. `max_tokens` is distinguished from `end_turn`. Each reason maps to a specific UI treatment.

**Why better**: No silent exits. Support and debugging can query `terminal_reason` to understand any run's outcome. The UI can render appropriate guidance for each case.

### 5. SSE reconnect: redis-only → db-first with stream catch-up

**Before**: Reload depends on Redis stream for replay. If the stream is expired, trimmed, or the run is already terminal with `activeRunId` cleared, content is lost.

**After**: Reload reads `chat_messages` from DB (which now has incremental content). If the run is still active, SSE attaches for live events and deduplicates against what's already loaded. Redis stream is a transport optimization, not a source of truth.

**Why better**: Eliminates the entire category of "stream expired/trimmed/missed events" bugs. DB is always the authoritative source.

### 6. Worker idempotency: none → status-check guard

**Before**: A re-delivered job re-executes the entire turn, potentially inserting duplicate assistant messages and re-running tools.

**After**: First line of `runAgentTurn` checks `agent_runs.status`. If terminal, skip. If `running` with an existing assistant message for this `runId`, skip. Simple, zero-cost guard.

**Why better**: Safe at-least-once delivery without distributed locks.

## Complexity Tracking

No constitution violations to justify. All changes use existing patterns and infrastructure.

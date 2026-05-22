# Data Model: Agent Loop & Chat Reliability Hardening

**Branch**: `003-agent-loop-hardening` | **Date**: 2026-05-21

## Design Philosophy

This hardening effort deliberately minimizes schema changes. The existing tables are sound; the problem is *when* and *how* they are written, not *what* they store. The changes below add the minimal columns needed to support incremental persistence, terminal-state classification, and idempotency — while leaving the existing schema intact.

---

## Schema Changes

### 1. `chat_messages` — add `run_id` column

**Purpose**: Link an assistant message to the run that produced it. Enables idempotency checks (FR-019: don't insert a duplicate if the same run re-delivers) and allows the UI to show which run generated which messages.

```sql
ALTER TABLE chat_messages ADD COLUMN run_id TEXT REFERENCES agent_runs(id);
CREATE INDEX idx_chat_messages_run_id ON chat_messages(run_id);
```

**Impact**: Existing rows get `run_id = NULL` (backfill optional). New assistant rows created by `persistAssistantMessage` carry the `run_id`.

### 2. `agent_runs` — add `terminal_reason` column

**Purpose**: Stores the fine-grained terminal classification from FR-005. The existing `status` column (`completed`, `aborted`, `failed`, `error`) covers the broad category; `terminal_reason` captures the *why*.

```sql
ALTER TABLE agent_runs ADD COLUMN terminal_reason TEXT;
```

**Allowed values** (enforced in application code, not DB constraint):

| terminal_reason | status | Description |
|-----------------|--------|-------------|
| `end_turn` | completed | Model produced a final response naturally |
| `step_limit` | completed | Max steps reached; user can continue |
| `stopped` | aborted | User clicked Stop |
| `timeout` | aborted | Turn timeout elapsed |
| `coalesced` | aborted | New message superseded this run |
| `worker_lost` | aborted | Worker crash, recovered by dead letter |
| `empty_response` | failed | Model returned no actionable output after retries |
| `provider_transient` | failed | LLM provider error after retry budget exhausted |
| `provider_fatal` | failed | Non-retryable provider error (auth, invalid request) |
| `tool_fatal` | failed | Tool threw non-retryable error that killed the run |
| `internal` | error | Unexpected internal error |
| `max_tokens` | completed | Model hit output token limit without completing |

### 3. `agent_runs` — add `last_heartbeat_at` column

**Purpose**: Track run liveness for stale-run detection (FR-020, FR-025, SC-008).

```sql
ALTER TABLE agent_runs ADD COLUMN last_heartbeat_at TIMESTAMPTZ;
```

Updated by the worker every ~15 seconds during active processing. The recovery system queries `WHERE status = 'running' AND last_heartbeat_at < NOW() - INTERVAL '5 minutes'` to find stalled runs.

---

## Existing Tables — Behavior Changes (No Schema Changes)

### `chat_messages`

**Current behavior**: One INSERT at turn end via `persistAssistantMessage`.

**New behavior**: 
- **First step**: INSERT a new assistant row with `run_id`, initial `parts`, and empty `model_messages`.
- **Each subsequent step**: UPDATE the same row, appending to `parts` via upsert (`SET parts = $1, model_messages = $2, updated_at = NOW()`).
- **Turn end**: Final UPDATE with merged `parts` and complete `model_messages`. No behavioral change to the row — it's the same row, just updated incrementally.
- **Abort/error path**: The row already has partial content from incremental writes; finalization updates `parts` one last time (with any remaining content) — content is never lost.

### `chats`

**Current behavior**: `active_run_id` is cleared in `updateRunStatus` (on terminal).

**New behavior**: Same, but `active_run_id` is cleared atomically with the final run status update. No additional change.

### `agent_runs`

**Current behavior**: Status updated to `completed`/`failed`/`aborted` at turn end.

**New behavior**: Additionally:
- `terminal_reason` is set alongside `status`.
- `last_heartbeat_at` is updated periodically during the run.
- Before execution, the worker checks `status` — if already terminal, the job is skipped (idempotency guard per RQ-6).

### Redis `run:{runId}:events` stream

**Current behavior**: Token, tool_call, tool_result, done/aborted/error events. MAXLEN ~2000, EXPIRE 24h.

**New behavior**: Additionally:
- `heartbeat` events every ~15s carrying `{ type: "heartbeat", timestamp, activity }`.
- `step_persisted` events after each incremental DB write, carrying `{ type: "step_persisted", step, partCount }` — allows the SSE client to know the DB is up to date without polling.
- Terminal events additionally carry `terminal_reason`.

---

## State Machine Updates

The existing `AgentRunStateMachine` in `packages/platform/src/state-machine.ts` is well-designed and largely unchanged. Additions:

### New status value: none needed

The existing statuses (`queued`, `running`, `paused`, `completed`, `aborted`, `failed`, `error`) cover all cases. The new `terminal_reason` column provides finer granularity without adding states.

### New transition: `run.step_limit_continued`

For the "Continue" button at step limit:
- A step-limit run ends as `completed` with `terminal_reason = "step_limit"`.
- The "Continue" action creates a **new** `agent_runs` row (status `queued`), not a transition on the old one.
- This preserves the invariant that terminal states have no outgoing transitions.

---

## Entity Relationship Diagram (Updated)

```
users
  └── sessions
        ├── chats (1:1 per session)
        │     ├── active_run_id → agent_runs (nullable; set during run, cleared on terminal)
        │     └── chat_messages
        │           ├── role: user | assistant
        │           ├── parts: jsonb (text, tool_call with embedded result, file_changed, ...)
        │           ├── model_messages: jsonb (LLM-native format for continuity)
        │           └── run_id → agent_runs (NEW: nullable, set for assistant messages)
        │
        ├── agent_runs (1:N per session, 1 per turn attempt)
        │     ├── status: queued → running → completed|aborted|failed|error
        │     ├── terminal_reason: (NEW) fine-grained classification
        │     ├── last_heartbeat_at: (NEW) liveness signal
        │     ├── prompt_tokens, completion_tokens
        │     └── started_at, finished_at, total_duration_ms
        │
        └── event_series → agent_events (observability, unchanged)
              └── NOT used for chat rendering

Redis (ephemeral, not authoritative):
  run:{runId}:events   → Stream (SSE transport; now also heartbeat + step_persisted events)
  run:{runId}           → Pub/Sub (live fanout)
  run:{runId}:abort     → Key (stop signal, now polled during tool exec too)
  run:{runId}:status    → Key (terminal status cache for SSE fast-path)
```

---

## Tool Call Part Schema (within `chat_messages.parts`)

No schema change to the part types. The existing shape is:

```typescript
type AssistantPart =
  | { type: "text"; text: string }
  | { type: "tool_call"; toolName: string; toolCallId: string; args: unknown; result?: unknown; status?: "interrupted" }
  | { type: "tool_result"; toolCallId: string; result: unknown }
  | { type: "file_changed"; path: string; additions: number; deletions: number; unifiedDiffPreview?: string }
  | { type: "task"; ... }
  | { type: "ask_user"; ... }
```

**New addition**: `status?: "interrupted"` field on `tool_call` parts. Set when Stop interrupts a tool mid-execution. The result field may be absent or partial. The UI renders this with a clear "interrupted" indicator.

---

## Migration Strategy

1. **Migration file**: `apps/web/lib/db/migrations/0006_agent_loop_hardening.sql`
   - `ALTER TABLE chat_messages ADD COLUMN run_id TEXT REFERENCES agent_runs(id)`
   - `ALTER TABLE agent_runs ADD COLUMN terminal_reason TEXT`
   - `ALTER TABLE agent_runs ADD COLUMN last_heartbeat_at TIMESTAMPTZ`
   - Index creation
2. **Drizzle schema update**: `packages/db/schema/session.ts` — add columns to table definitions.
3. **No data backfill required**: Existing rows work with `NULL` values for new columns.
4. **Rollback**: All additions are nullable; dropping columns is safe.

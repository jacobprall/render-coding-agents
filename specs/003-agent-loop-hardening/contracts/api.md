# API Contracts: Agent Loop & Chat Reliability Hardening

**Branch**: `003-agent-loop-hardening` | **Date**: 2026-05-21

## Overview

This document specifies changes and additions to the existing API surface. The platform exposes REST + SSE endpoints through both the web app (`apps/web/app/api/`) and the gateway (`apps/gateway/src/routes/`). Changes are additive; no existing endpoint signatures break.

---

## 1. SSE Stream Events — Additions

**Endpoint**: `GET /api/sessions/:id/stream` (web) / `GET /api/stream/sessions/:id` (gateway)

### 1.1 `heartbeat` event (new)

Published every ~15 seconds by the worker during active processing.

```typescript
{
  type: "heartbeat";
  timestamp: string;       // ISO 8601
  activity: string;        // "llm_call" | "tool:<toolName>" | "idle"
  step: number;            // current step index
}
```

**Client behavior**: Update "last active" indicator. If no heartbeat received for >30s and status is not terminal, show "agent may be unresponsive" indicator.

### 1.2 `step_persisted` event (new)

Published after each incremental DB write of assistant parts.

```typescript
{
  type: "step_persisted";
  step: number;
  partCount: number;       // total parts persisted so far
  assistantMessageId: string;
}
```

**Client behavior**: No visual change needed. Used internally to know that a reload at this point will recover the conversation up to this step.

### 1.3 Terminal events — enhanced payload

Existing `done`, `aborted`, `error` events gain a `terminalReason` field:

```typescript
// done
{
  type: "done";
  assistantMessageId?: string;
  assistantParts?: unknown[];
  terminalReason: "end_turn" | "step_limit" | "max_tokens";
}

// aborted
{
  type: "aborted";
  terminalReason: "stopped" | "timeout" | "coalesced" | "worker_lost";
  assistantParts?: unknown[];   // NEW: partial content for client recovery
}

// error
{
  type: "error";
  message: string;
  code: string;
  retryable: boolean;
  terminalReason: "empty_response" | "provider_transient" | "provider_fatal" | "tool_fatal" | "internal";
}
```

**Client behavior**: Use `terminalReason` to render the appropriate terminal-state indicator (FR-024). On `step_limit`, show "Continue" button + free-form input. On `stopped`, show "Stopped" badge. On provider errors, show retry guidance.

---

## 2. Stop Endpoint — Behavior Change

**Endpoint**: `POST /api/sessions/:id/stop`

### Current behavior
Sets `run:{runId}:abort = "1"` in Redis. Returns `200 OK`.

### New behavior
Same Redis flag write. Additionally:
- Response includes `{ runId, acknowledged: true }`.
- The abort flag is now polled every 500ms by the worker (not just between steps), and wired into the `AbortController.signal` that governs the LLM stream and tool execution.
- The endpoint remains idempotent: calling it when no run is active or when the run is already terminal returns `200 OK` with `{ runId: null, acknowledged: true }`.

**Request**: `POST /api/sessions/:id/stop`  
**Response**: `200 OK`
```typescript
{
  runId: string | null;
  acknowledged: boolean;
}
```

---

## 3. Continue Endpoint (New)

**Endpoint**: `POST /api/sessions/:id/continue`

Resumes a session after a step-limit terminal. Creates a new run that continues from the prior context.

**Request**:
```typescript
POST /api/sessions/:id/continue
{
  modelId?: string;  // optional override; defaults to session's model
}
```

**Response**: `200 OK`
```typescript
{
  runId: string;        // new run ID
  sessionId: string;
}
```

**Behavior**:
1. Validates that the latest run's `terminal_reason = "step_limit"`.
2. Creates a new `agent_runs` row (status `queued`).
3. Enqueues a job with the prior run's `modelMessages` as context, extended step budget.
4. Sets `chats.activeRunId` to the new run.
5. Returns the new run ID.

**Error cases**:
- `400` if the latest run is not `step_limit`.
- `404` if session not found.
- `409` if a run is already active.

---

## 4. Message Load — Behavior Change

**Endpoint**: `GET` (SSR in `sessions/[id]/page.tsx`)

### Current behavior
Loads `chat_messages` ordered by `created_at`. Assistant messages only exist if the run completed.

### New behavior
Same query. Assistant messages now exist mid-turn (from incremental persistence). The UI renders them identically to completed messages, but the SSE stream may append further parts during the run. The client deduplicates by `toolCallId` or part sequence.

---

## 5. SSE Reconnect Contract

When the SSE client reconnects (page reload, network recovery):

1. **If `activeRunId` is set on the chat**:
   - Server replays from Redis stream using `Last-Event-ID` header.
   - Client loads `chat_messages` from DB (SSR or API fetch) — includes incrementally-persisted assistant parts.
   - Client deduplicates: parts already in `chat_messages` are not duplicated by stream events. The `toolCallId` for tool calls and part ordering for text serve as dedup keys.

2. **If `activeRunId` is null** (run is terminal):
   - No SSE stream needed.
   - All content is in `chat_messages` from the DB.
   - Terminal status is on the `agent_runs` row (`status` + `terminal_reason`).

3. **Deduplication rule**: The client maintains a set of seen `toolCallId` values from the DB-loaded message. Incoming stream events with a `toolCallId` already in the set are dropped. Text parts use a monotonic sequence counter (already present as `_seqCounter`).

---

## 6. Internal Worker Events (Not API-facing)

These are implementation details in the worker ↔ Redis ↔ SSE chain, documented here for completeness:

| Event | Publisher | Consumer | Purpose |
|-------|-----------|----------|---------|
| `token` | Worker `onToken` | SSE → UI | Streaming text tokens |
| `tool_call` | Worker `onStep` | SSE → UI | Tool invocation start |
| `tool_result` | Worker `onStep` | SSE → UI | Tool invocation result |
| `file_changed` | Worker (tool callback) | SSE → UI | File modification notification |
| `ask_user` | Worker (tool callback) | SSE → UI | Interactive prompt |
| `heartbeat` | Worker (interval) | SSE → UI, recovery system | Liveness signal (NEW) |
| `step_persisted` | Worker (after DB write) | SSE → UI | Persistence confirmation (NEW) |
| `done` | Worker (turn end) | SSE → UI | Successful completion |
| `aborted` | Worker (abort path) | SSE → UI | Stop/timeout/coalesce |
| `error` | Worker (error path) | SSE → UI | Failure |

# Quickstart: Agent Loop & Chat Reliability Hardening

**Branch**: `003-agent-loop-hardening` | **Date**: 2026-05-21

## What This Work Does

This is a reliability hardening of the agent loop and chat system. It fixes three user-facing bugs:
1. Agent silently stops mid-conversation with no final message
2. Clicking Stop discards all in-progress tool calls and assistant text
3. Reloading the page loses agent messages that were previously visible

The root cause is the same across all three: **assistant content is only saved to the database at the very end of a turn.** This work adds incremental persistence, wires abort signals properly, classifies all loop exit paths, and fixes the UI state machine.

## Key Design Decisions

- **Incremental persistence**: Assistant parts are written to `chat_messages` after each completed step (LLM response + tool results), not just at turn end.
- **Immediate stop**: Stop cancels the current LLM stream and signals tools to cancel. Only the interrupted call is marked "interrupted"; completed work is preserved.
- **Silent retry for empty responses**: If the model returns nothing actionable, retry up to 2 times before surfacing a failure.
- **Terminal reason classification**: Every run exit gets a documented `terminal_reason` (e.g., `end_turn`, `step_limit`, `stopped`, `provider_transient`).
- **High step limit**: The default step limit favors maximum agent autonomy. At the limit, both a "Continue" button and free-form input are available.

## Files You'll Touch

### Agent worker (`apps/agent/src/`)
- `loop.ts` — Add empty-response retry, abort-signal checks during tool execution, `terminationReason` in return type, per-tool abort signal forwarding
- `agent.ts` — Wire merged abort controller (timeout + user stop), heartbeat interval, incremental `persistAssistantMessage` in `onStep`, timeout-abort persistence, `terminal_reason` in all paths
- `run-persistence.ts` — Add `upsertAssistantMessage` (insert-or-update), add `terminal_reason` param to `updateRunStatus`, add heartbeat update function, publish `step_persisted` events
- `worker.ts` — Add idempotency guard (skip if run already terminal), improve dead-letter finalization
- `llm/anthropic.ts`, `llm/openai.ts` — Detect truncated streams, surface `max_tokens` finish reason

### Platform (`packages/platform/src/`)
- `events/run-stream.ts` — No changes needed (existing `publishRunEvent` works for new event types)
- `services/session.ts` — Fix stale "abort not enforced" log, add `continue()` method
- `state-machine.ts` — Add `terminal_reason` type, no new states needed
- `queue/job-queue.ts` — No changes needed

### Database (`packages/db/`)
- `schema/session.ts` — Add `runId` to `chatMessages`, `terminalReason` and `lastHeartbeatAt` to `agentRuns`
- New migration: `0006_agent_loop_hardening.sql`

### Web UI (`apps/web/`)
- `components/session/chat-reducer.ts` — Remove `FINISH_STREAMING` status guard, always flush on terminal events, use server-provided `assistantParts` as fallback
- `components/session/use-agent-chat.ts` — Stop handler: wait for `aborted` terminal event before finalizing, don't flush optimistically
- `components/session/message-list/message-area.tsx` — Show `streamingParts` even after `isStreaming` is false if they haven't been flushed
- `app/(authenticated)/sessions/[id]/page.tsx` — No changes needed (incremental persistence means DB already has mid-turn content)
- `app/api/sessions/[id]/continue/route.ts` — New endpoint for step-limit continuation
- `lib/ui/lib/chat-parts.ts` — Handle `heartbeat` and `step_persisted` event types, render `status: "interrupted"` on tool calls

### Gateway (`apps/gateway/src/routes/`)
- `stream.ts` — Handle `heartbeat` events in replay, add `terminalReason` to synthetic terminal events
- `sessions.ts` — Add `/continue` route

## Local Development

```bash
bun install
bun run infra:up
bun run db:push          # applies new migration
bun run dev              # starts all services
```

## Testing Strategy

1. **Happy path**: Send a message → agent completes → reload → all content visible
2. **Stop mid-turn**: Send message → wait for tool calls → Stop → verify content preserved → reload → still there
3. **Reload mid-turn**: Send message → wait for tool calls → hard reload → content visible + stream reattaches
4. **Empty response**: Mock provider to return empty content → verify retry + eventual labeled failure
5. **Provider error**: Mock 429/500 → verify retry with backoff → eventual success or labeled failure
6. **Step limit**: Set `MAX_AGENT_STEPS=3` → verify "step limit" marker + Continue button works
7. **Worker crash**: Start run → kill worker → restart → verify run finalized within 90s
8. **Idempotency**: Manually re-deliver a job → verify no duplicate messages

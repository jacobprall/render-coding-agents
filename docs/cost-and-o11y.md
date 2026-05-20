# coding-agents: Roadmap — Cost, Observability, Testing

Remaining work from the original refactor (R3, R4, R8). R1, R2, R5, R6, R7 are complete — see [`refactor-plan-archive.md`](refactor-plan-archive.md) for history.

---

## Current State

| Area | What exists | What's missing |
|------|-------------|----------------|
| **Cost** | `agent_runs.promptTokens/completionTokens` written by agent. `CostService` instantiated in container. `usage_events` table defined in schema. Policy layer (`cost-guard.ts`, `tool-filter.ts`) designed with clean interfaces. Pricing table in `packages/shared` (`MODEL_DEFS`). | `costUsd` not populated. `usage_events` not written to. Cost-guard not wired into dispatch. No per-user/org budgets. No cost dashboard. |
| **Observability** | Structured JSON logger (`packages/shared/lib/logger.ts`) used everywhere. In-memory Prometheus collector present but unused. Token counts on `agent_runs`. | No per-call LLM instrumentation. No `llm_calls` table. No error log table. No gateway request metrics. Prometheus collector is dead code. |
| **Testing** | ~10 test files. MCP tool tests in gateway. Basic agent config tests. | No agent loop tests. No cost pipeline tests. No platform service tests. No provider adapter tests. Thin gateway route coverage. |

---

## R3: Cost Control — Build the Pipeline

**Scope:** `packages/platform/`, `packages/db/`, `apps/agent/`

**Goal:** Every LLM call is metered, attributed, priced, and budget-checked. Cost data is queryable.

### Steps

1. **Instrument the LLM layer**
   - Hook into the agent's Anthropic/OpenAI HTTP adapters
   - After each API response, emit a cost event: `{ userId, orgId, sessionId, runId, model, provider, promptTokens, completionTokens, costUsd, latencyMs, timestamp }`
   - Write to `usage_events` table in Postgres

2. **Populate `costUsd`**
   - Use per-model token pricing from `MODEL_DEFS` (or a new `model_pricing` table for runtime updates)
   - Calculate: `costUsd = (promptTokens * inputPrice + completionTokens * outputPrice)`
   - Write to `agent_runs.costUsd` — change column type from text to numeric if needed

3. **Wire cost-guard**
   - Connect `packages/platform/src/policy/cost-guard.ts` to the job enqueue path
   - Before dispatching an agent job, evaluate: `canDispatch(userId, orgId)` → check spend vs budget
   - Return clear error when budget exceeded

4. **Per-user and per-org budgets**
   - Add `budgets` table (or columns on `orgs`/`users`): `monthlyLimitUsd`, `currentMonthSpendUsd`
   - Admin API to set/update budgets
   - Rollover logic: reset `currentMonthSpendUsd` on month boundary (cron or lazy check)

5. **Cost query surface**
   - Gateway endpoints: `/api/costs/summary` (by user, org, model, time period)
   - Gateway endpoints: `/api/costs/sessions/:id` (per-session breakdown)
   - Wire into UI: cost badge per session, cost dashboard page

### Key files
- `apps/agent/src/llm/anthropic.ts`, `openai.ts` — instrument here
- `packages/platform/src/services/cost.ts` — expand with budget logic
- `packages/platform/src/policy/cost-guard.ts` — wire into dispatch
- `packages/db/src/schema/` — `usage_events`, `agent_runs.costUsd`, new `budgets`

---

## R4: Observability — Postgres as Warehouse

**Scope:** `packages/platform/`, `packages/db/`, `apps/agent/`, `apps/gateway/`

**Goal:** All operational data (LLM calls, errors, request metrics) flows into Postgres. Queryable via SQL. No separate metrics stack.

### Steps

1. **Remove dead Prometheus collector**
   - Delete `packages/platform/src/observability/metrics.ts` (if still present) and any `/api/metrics` endpoint
   - Keep structured JSON logger as-is

2. **Define observability tables**
   - `llm_calls`: per-API-call detail (model, tokens, latency, cost, success/error, trace_id)
   - `agent_events`: structured event log (tool calls, phase transitions, errors)
   - `error_log`: caught exceptions with context (session, run, stack, severity)
   - These supplement `agent_runs` and `usage_events`

3. **Instrument the agent loop**
   - After each LLM API call → write to `llm_calls`
   - On tool execution → write to `agent_events`
   - On error → write to `error_log`
   - Use fire-and-forget writes (don't block the hot path)

4. **Instrument the gateway**
   - Hono middleware: log request method, path, status, latency to structured logs
   - Optionally write slow requests (>1s) or errors to `error_log`

5. **Query endpoints**
   - `/api/observability/llm-calls` — filterable by session, model, time range
   - `/api/observability/errors` — recent errors with context
   - `/api/observability/summary` — aggregate stats (calls/day, avg latency, error rate)

6. **Optional: OpenTelemetry trace IDs**
   - Generate a `traceId` per request, propagate through gateway → agent → sandbox
   - Store on `llm_calls` and `agent_events` for cross-service correlation
   - Don't require an OTel collector — just the IDs for future integration

### Key files
- `packages/db/src/schema/` — new tables
- `apps/agent/src/loop.ts` — instrument LLM calls and tool execution
- `apps/gateway/src/middleware/` — request logging middleware
- `packages/platform/src/observability/` — query helpers

### Overlap with R3
R3 and R4 share the LLM instrumentation point. The agent adapter hook writes to both `usage_events` (cost) and `llm_calls` (observability) in a single pass. Design the instrumentation once, feed both tables.

---

## R8: Improve Test Coverage

**Scope:** Entire codebase. Follows R3 + R4 (cost and observability code needs to exist before testing it).

### Target areas

1. **Agent loop** — Test the agentic loop (`apps/agent/src/loop.ts`): tool dispatch, abort handling, max-turns, error recovery. Mock LLM responses with recorded HTTP fixtures.

2. **Cost pipeline** (after R3) — Test token counting, `costUsd` calculation, budget enforcement, budget exceeded error path.

3. **Platform services** — Session lifecycle (create → message → complete), job enqueue/dequeue, event streaming, invite flow (create → accept → reject/expire).

4. **Provider adapters** — Anthropic and OpenAI HTTP adapter tests with recorded responses. Verify token extraction, error handling, streaming chunk parsing.

5. **Gateway routes** — Expand beyond existing MCP tests. Cover session CRUD, message send, streaming, webhook dispatch, cost endpoints.

### Approach
- Use Vitest (already configured)
- Recorded HTTP fixtures for LLM providers (no live API calls in CI)
- In-memory Postgres (or test DB) for service integration tests
- Aim for critical path coverage, not 100% line coverage

---

## Dependency Graph

```
R3 (Cost Control) ──┐
                     ├── R8 (Tests)
R4 (Observability) ──┘

R3 and R4 can proceed in parallel.
R3 + R4 share an LLM instrumentation hook — coordinate the adapter interface.
R8 follows after R3 + R4 land.
```

---

## See also

- [`refactor-plan-archive.md`](refactor-plan-archive.md) — Original refactor plan with completed items (R1, R2, R5, R6, R7)
- [`efficiency-refactor.md`](efficiency-refactor.md) — E1–E5 token optimization and cost reduction (prompt caching, skills-as-tools, tool result compaction, subagent model routing, tiered intelligence). Complements R3.

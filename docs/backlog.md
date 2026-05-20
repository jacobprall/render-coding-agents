# Backlog

### Cost control (R3)

- **Instrument LLM layer** — Hook into Anthropic/OpenAI adapters to emit cost events (model, tokens, costUsd, latency) after each API call. Write to `usage_events`.
- **Populate `costUsd`** — Calculate from per-model pricing in `MODEL_DEFS`. Write to `agent_runs.costUsd`.
- **Wire cost-guard** — Connect `cost-guard.ts` to the job enqueue path. Check spend vs budget before dispatching.
- **Per-user/org budgets** — `budgets` table with `monthlyLimitUsd`. Admin API to set/update. Monthly rollover.
- **Cost query surface** — Gateway endpoints for cost summaries by user/org/model/session. UI cost badge + dashboard.

### Observability (R4)

- **Remove dead Prometheus collector** — Delete unused metrics code and `/api/metrics` endpoint.
- **Observability tables** — `llm_calls` (per-call detail), `agent_events` (tool calls, phase transitions), `error_log` (exceptions with context).
- **Instrument agent loop** — Write to `llm_calls` after each LLM call, `agent_events` on tool execution, `error_log` on error. Fire-and-forget.
- **Instrument gateway** — Hono middleware for request logging (method, path, status, latency). Log slow/errored requests.
- **Query endpoints** — `/api/observability/llm-calls`, `/api/observability/errors`, `/api/observability/summary`.
- **OpenTelemetry trace IDs** — Generate `traceId` per request, propagate gateway → agent → sandbox. Store for future OTel integration.

### Test coverage (R8)

- **Agent loop tests** — Tool dispatch, abort handling, max-turns, error recovery. Mock LLM with recorded fixtures.
- **Cost pipeline tests** — Token counting, `costUsd` calculation, budget enforcement, budget exceeded path.
- **Platform service tests** — Session lifecycle, job enqueue/dequeue, event streaming, invite flow.
- **Provider adapter tests** — Anthropic/OpenAI HTTP adapters with recorded responses. Token extraction, error handling, streaming.
- **Gateway route tests** — Session CRUD, message send, streaming, webhook dispatch, cost endpoints.

### Sandbox hardening

- **Read-only root filesystem** — Mount the container rootfs as read-only so agents can't modify system binaries. Only `/workspace` and `/tmp` writable.
- **Capped tmpfs for `/tmp`** — Mount `/tmp` as tmpfs with a size limit (e.g. 512MB) to prevent cross-session abuse and disk exhaustion.
- **Network restriction** — Block outbound network from child processes via `iptables` rules in the container entrypoint. Agents shouldn't need arbitrary internet access from the sandbox.
- **Drop capabilities and `no-new-privileges`** — Run the container with `--security-opt=no-new-privileges`, drop all Linux capabilities, and add back only what's strictly needed.
- **Per-session disk quotas** — Enforce per-session workspace size limits instead of relying only on the global disk cleanup cron.
- **`/proc` and `/sys` restrictions** — Mount as read-only or mask sensitive paths to prevent information leakage between sessions.

### Webhook triggers

- **Inbound webhook handling** — Full webhook-based inbound message handling to trigger agent workflows (e.g. GitHub PR events, issue comments).

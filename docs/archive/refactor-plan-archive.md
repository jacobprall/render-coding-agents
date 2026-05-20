# coding-agents: Refactor Plan

This document serves as the master plan for refactoring OpenForge into **coding-agents** — a focused, observable, cost-aware coding agent platform designed for a 30-person engineering org with the ability to scale up or down.

---

## Part 1: Module Inventory

Every module in the current codebase, grouped by layer. Evaluate each for keep / rework / remove.

### Apps

| # | Module | Path | Summary | Status |
|---|--------|------|---------|--------|
| 1 | **Web** | `apps/web` | Next.js 15 dashboard. Focused chat UI, session management, settings (profile, API keys, connections, team invites). Auth via NextAuth v5 credentials provider (invite-only registration). GitHub connected separately via OAuth for repo access. API routes proxy to gateway. | Reworked |
| 2 | **Gateway** | `apps/gateway` | Hono REST + SSE + MCP server. Authenticated CRUD for sessions, repos, PRs, settings. GitHub webhook receiver. SSE streaming for run events. Forgejo/GitLab/Render webhook routes removed. | Reworked |
| 3 | **Agent** | `apps/agent` | Bun worker consuming Redis Streams job queue. Custom agentic loop with Anthropic + OpenAI HTTP adapters (AI SDK removed). ~20 tools (bash, file ops, git, PR lifecycle, ask-user, subagents). Skills system with builtin markdown instructions. | Reworked |
| 4 | **CLI** | `apps/cli` | `forge` command-line client. Commands: chat, send, list, stop, pause, resume, stream, config. Talks directly to gateway REST + SSE. ~471 LOC. | Keep |
| 5 | **Sandbox** | `apps/sandbox` | Isolated code execution. HTTP server in Docker (bash exec, file ops, git, snapshots, verify). Path security, git policy, disk usage, process management. Moved from `packages/sandbox`. | Reworked |

### Packages

| # | Module | Path | Summary | Status |
|---|--------|------|---------|--------|
| 6 | **db** | `packages/db` | Drizzle ORM schema. Tables across domain files (auth, session, platform, org, ci, sync, webhooks). Schema columns renamed from Forgejo naming (`externalProviderId`, `externalUsername`). `usage_events` table defined but not yet written to. `costUsd` on `agent_runs` not yet populated. | Reworked |
| 7 | **platform** | `packages/platform` | Framework-agnostic business logic. Domain services: Session, Repo, PullRequest, Org, Settings, Model, CI, Webhook, Cost, Invite. GitHub-only forge provider. Redis Streams job queue + event bus. Policy layer (cost-guard, tool-filter, credential-redactor) designed but not yet wired into runtime. | Reworked |
| 8 | **shared** | `packages/shared` | Cross-cutting utilities: error hierarchy, structured JSON logger, AES encryption, model catalog (`MODEL_DEFS`), stream event types, request IDs. | Keep |

### Infrastructure & Config

| # | Module | Path | Summary | Status |
|---|--------|------|---------|--------|
| 9 | **Docker Compose** | `docker-compose.yml` | Local dev: Postgres 16 (:5433), Redis 7 (:6380), sandbox (:3001). | Keep |
| 10 | **Render Blueprint** | `render.yaml` | Production deploy: web, agent worker, sandbox, gateway, Redis, Postgres. | Keep |
| 11 | **Docs** | `docs/` | Architecture doc, this refactor plan. | Keep |
| 12 | **Tests** | `tests/` | ~10 test files. Thin coverage. | Needs work |

### Key Subsystems (cross-cutting)

| # | Subsystem | Where | Summary | Status |
|---|-----------|-------|---------|--------|
| 13 | **Auth** | `apps/web/lib/auth/`, `apps/gateway/src/middleware/auth.ts` | Invite-only registration (admin creates invite, user sets password). Email/password sign-in via credentials provider. GitHub connected separately via standalone OAuth flow for repo access. Gateway API key auth + admin bypass. | Reworked |
| 14 | **Permissions** | `packages/platform/src/policy/` | Policy engine with cost-guard, tool-filter, credential-redactor. Clean interfaces. **Not yet wired into runtime.** | Pending |
| 15 | **Cost tracking** | `packages/db`, `packages/platform/src/services/cost.ts` | `agent_runs.promptTokens/completionTokens` written by agent. `costUsd` not yet populated. `usage_events` not yet written to. Cost-guard not yet wired. | Pending |
| 16 | **Observability** | `packages/shared/lib/logger.ts` | Structured JSON logging (used). In-memory Prometheus collector still present but unused. No call-level instrumentation yet. | Pending |
| 17 | **Job queue** | `packages/platform/src/queue/`, `packages/platform/src/events/` | Redis Streams for job queue (at-least-once, consumer groups, dead letter). Redis Streams + pub/sub for run event streaming. | Keep |
| 18 | **Forge providers** | `packages/platform/src/forge/` | GitHub-only. Factory creates `GitHubProvider`. Forgejo/GitLab adapters removed. | Reworked |

---

## Part 2: Refactor Principles

These principles guide every decision in the refactor.

1. **Name: coding-agents.** Rename from OpenForge. All package scopes, config, docs, and deploy artifacts update to reflect the new identity.

2. **Cost control is first-class.** Every LLM API call is metered, attributed to a user/org/session, and written to Postgres as the cost warehouse. Per-user and per-org budgets are enforced before dispatching work. Cost data is queryable and dashboardable. This is not optional scaffolding — it ships working on day one.

3. **Observability is built on Render Postgres.** Token usage, latency, error rates, session traces, and cost data all flow into Postgres as the warehouse. No separate metrics stack. Queryable via SQL, exposable via simple dashboards or Metabase/Grafana. Structured logging stays; the in-memory Prometheus collector is removed.

4. **Permissions are a plug-and-play surface, not a built-in system.** The existing permissions interfaces (policy, cost-guard, tool-filter, credential-redactor) are kept as extension points. Default policy is permissive. Users can plug in their own enforcement. We do not build advanced RBAC — every agent is sandboxed, which is the primary security boundary.

5. **The chat experience is the product.** UI is focused on a great end-to-end chat: fast token streaming, clear tool rendering, session management, cost visibility. Everything else (repo browser, org admin, mirrors, activity feed, search) is cut or deferred. Performance and focus over breadth.

6. **Own the LLM layer.** Remove the Vercel AI SDK. Build thin provider adapters for Anthropic and OpenAI. Own the agentic loop (call API, dispatch tools, repeat). This gives us: token-level streaming, direct cost instrumentation at the HTTP boundary, full observability, and no dependency on SDK upgrade cycles.

7. **Design for 30 engineers, scale in both directions.** Architecture choices target a 30-person engineering org as the sweet spot. Single Postgres, single Redis, simple deployment. But interfaces (queue, events, auth) stay pluggable for teams that outgrow the defaults.

8. **Remove dead code aggressively.** Unwired permissions calls, empty metrics, unused `@ai-sdk/react`, `CostBadge`, `usage_events` without writers, duplicate migration files, deprecated Redis helpers — all cut. If it doesn't run in production, it doesn't exist in the repo.

9. **Clean up Forgejo coupling and other hardcoded values.** Generalize schema columns (`forgejoUserId` → `externalId` or similar), fix `forgeUserId ?? 0`, remove Forgejo bootstrap as default path, correct migration defaults. GitHub-first, provider-agnostic naming.

10. **Keep the platform layer.** The `PlatformContainer` / service architecture is good. Domain services, pluggable interfaces, clean composition root. This stays and improves.

---

## Part 3: Refactors

Ordered by priority and dependency. Each refactor is a discrete unit of work.

### ~~R1: Remove Vercel AI SDK — Own the LLM Layer~~ DONE

**Status: Complete.**

Replaced `generateText()` / `tool()` / `@ai-sdk/*` with:
- Custom agentic loop in `apps/agent/src/loop.ts`
- HTTP provider adapters for Anthropic (`apps/agent/src/llm/anthropic.ts`) and OpenAI (`apps/agent/src/llm/openai.ts`)
- Own tool definition format (Zod schema + execute function)
- `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/react` removed from dependencies
- Thinking block signature support for Anthropic

---

### R2: UI Refactor — Focus on Chat — PARTIAL

**Status: Core layout done. Polish deferred.**

**Done:**
- Removed repo browser, org admin, activity feed, search, mirror management, shared session view
- Auth reworked: invite-only registration, email/password sign-in, GitHub connect-only OAuth
- Settings pages: Profile, API Keys, Connections (GitHub connect/disconnect), Team (invite management)
- New-session page shows "Connect GitHub" banner when no forge token
- Collapsible session drawer from icon rail (Cmd+K toggle, search, status dots, SWR fetch)
- GET `/api/sessions` endpoint for client-side session listing

**Deferred:**
- Token-level streaming in chat UI (blocked on wiring streaming events end-to-end)
- Tool call rendering polish pass
- Cost display per session (blocked on R3)
- Performance: bundle optimization, fewer client components, faster load

---

### R3: Cost Control — Build the Pipeline — NOT STARTED

**Scope:** `packages/platform/`, `packages/db/`, `apps/agent/`

Build working cost control end-to-end:

1. **Instrument the LLM layer** (R1 complete — can now instrument): Every API call records `{ userId, orgId, sessionId, runId, model, provider, promptTokens, completionTokens, costUsd, latencyMs, timestamp }` to Postgres.
2. **Populate `usage_events`:** Write to the existing table (or redesign it) on every LLM call.
3. **Calculate `costUsd`:** Use per-model token pricing (maintain a pricing table). Write to `agent_runs.costUsd` (change from text to numeric).
4. **Wire cost-guard:** Connect `packages/platform/src/policy/cost-guard.ts` to the agent enqueue path. Check budget before dispatching.
5. **Per-user and per-org budgets:** Replace `DEFAULT_QUOTA` hardcoded values with configurable limits in the `orgs` or a new `budgets` table.
6. **Dashboard query surface:** Expose cost aggregation queries (by user, by org, by model, by time period) via gateway API endpoints. Wire into the simplified UI.

---

### R4: Observability — Postgres as Warehouse — NOT STARTED

**Scope:** `packages/platform/`, `packages/db/`, `apps/agent/`, `apps/gateway/`

Build observability on Render Postgres:

1. **Remove in-memory Prometheus collector** (`packages/platform/src/observability/metrics.ts`) and the `/api/metrics` endpoint.
2. **Define observability tables:** `llm_calls` (per-API-call detail), `agent_events` (structured event log), `error_log`. These supplement `agent_runs` and `usage_events`.
3. **Instrument the agent loop:** Log every LLM call (model, tokens, latency, cost, success/error) to `llm_calls`.
4. **Instrument the gateway:** Log request counts, latencies, error rates to `agent_events` or structured logs.
5. **Structured logging stays:** Keep `packages/shared/lib/logger.ts`. Ensure consistent JSON format across all apps.
6. **Query endpoints:** Expose summary/aggregation endpoints for cost, usage, and error dashboards.
7. **Optional:** Add OpenTelemetry trace IDs to request flow for distributed tracing readiness (but don't require an OTel collector).

---

### ~~R5: Clean Up Forgejo Coupling~~ DONE

**Status: Complete.**

- Forgejo and GitLab forge adapters removed; GitHub-only via `GitHubProvider`
- Schema columns renamed: `forgejoUserId` → `externalProviderId`, `forgejoUsername` → `externalUsername`
- `forgeUserId ?? 0` fallback removed
- Forgejo bootstrap removed; admin created via credentials provider
- Gateway Forgejo/GitLab/Render webhook routes removed
- Agent Forgejo-specific logic removed (upstream mirrors, forge type checks)

---

### ~~R6: Remove Dead Code~~ DONE

**Status: Complete.**

- Removed `@ai-sdk/react`, deprecated Redis helpers, Forgejo infrastructure, dead services
- Removed trust tiers, sandbox-url, graceful-shutdown, multi-agent from agent
- Removed `CostBadge` component, orphaned manual SQL migrations (5 files)
- Removed Forgejo health check, `forgejoWebOrigin` prop chain, Forgejo/GitLab/Render inbound adapters
- Removed orphaned session components (spec-panel, ci-events-panel, session-side-panel, new-session-input)
- Removed orphaned layout components (sidebar, top-bar, page-header), unused UI primitives (9 files)
- Removed orphaned diff components, dead-letter queue, shared hooks duplicates, client.ts barrel
- Removed orphaned lib files (api-utils, api/errors, csrf)
- Cleaned barrel exports across platform, shared, web layout
- Full codebase audit completed; all high-impact dead code removed

---

### ~~R7: Rename to coding-agents~~ DONE

**Status: Complete.**

- Package scope: `@coding-agents/*`
- Root package name: `coding-agents`
- Render services, Docker compose, docs updated
- CLI binary: `forge` (kept for brevity)

---

### R8: Improve Test Coverage — NOT STARTED

**Scope:** Entire codebase

Current: ~10 test files. Target areas:

1. **Agent loop** (R1 done — can now test): Test the owned agentic loop, tool dispatch, abort handling.
2. **Cost pipeline** (after R3): Test token counting, cost calculation, budget enforcement.
3. **Platform services:** Session lifecycle, job enqueue, event streaming, invite flow.
4. **Provider adapters:** Anthropic and OpenAI HTTP adapter tests with recorded responses.
5. **Gateway routes:** Expand beyond MCP tests to cover session CRUD, streaming, webhooks.

---

## Dependency Graph

```
R1 (Remove AI SDK) ✅
├── R3 (Cost Control) — unblocked, not started
├── R4 (Observability) — unblocked, not started
└── R2 (UI Refactor) — removals done, improvements pending

R5 (Forgejo Cleanup) ✅
R6 (Dead Code) ✅
R7 (Rename) ✅
R8 (Tests) — not started, follows R3 + R4
```

**Next up:** R3 (Cost Control) and R4 (Observability) can proceed in parallel. R8 follows after R3/R4.

**See also:** [`docs/efficiency-refactor.md`](efficiency-refactor.md) — E1–E5 token optimization and cost reduction (prompt caching, skills-as-tools, tool result compaction, subagent model routing, tiered intelligence). Complements R3; reduces the spend that hits R3's budgets.

# coding-agents: Refactor Plan

This document serves as the master plan for refactoring OpenForge into **coding-agents** — a focused, observable, cost-aware coding agent platform designed for a 30-person engineering org with the ability to scale up or down.

---

## Part 1: Module Inventory

Every module in the current codebase, grouped by layer. Evaluate each for keep / rework / remove.

### Apps

| # | Module | Path | Summary | Status |
|---|--------|------|---------|--------|
| 1 | **Web** | `apps/web` | Next.js 15 dashboard. 27 pages, 71 components, 69 API routes. Covers auth (NextAuth v5 + GitHub OAuth), session/chat UI, full repo browser (tree/blob/edit/commits), org management, settings, mirrors, activity feed, search. Most API routes proxy to gateway. ~19k LOC. | Evaluate |
| 2 | **Gateway** | `apps/gateway` | Hono REST + SSE + MCP server. Authenticated CRUD for sessions, repos, PRs, orgs, projects, skills, mirrors, invites, settings. Webhook receivers (GitHub, GitLab, Forgejo, Render). SSE streaming for run events. ~5.4k LOC. | Evaluate |
| 3 | **Agent** | `apps/agent` | Bun worker consuming Redis Streams job queue. Runs LLM agent loop via Vercel AI SDK `generateText()`. ~30 tools (bash, file ops, git, PR lifecycle, Render deploy, ask-user). Subagent support via nested `generateText` in `task` tool. Trust tiers for destructive Render ops. ~4.4k LOC. | Evaluate |
| 4 | **CLI** | `apps/cli` | `forge` command-line client. Commands: chat, send, list, stop, pause, resume, stream, config. Talks directly to gateway REST + SSE. ~471 LOC. | Evaluate |

### Packages

| # | Module | Path | Summary | Status |
|---|--------|------|---------|--------|
| 5 | **db** | `packages/db` | Drizzle ORM schema. 24 tables across 9 domain files (auth, session, platform, org, ci, sync, infra, webhooks). No DB driver — apps create their own clients. Legacy Forgejo naming on `users` table (`forgejoUserId`, `forgejoUsername`). `usage_events` table defined but never written to. `costUsd` on `agent_runs` is text type and never populated. ~993 LOC. | Evaluate |
| 6 | **platform** | `packages/platform` | Framework-agnostic business logic. 14 domain services (Session, Repo, PullRequest, Org, Inbox, Settings, Skill, Model, Notification, Invite, Project, Mirror, CI, Webhook). Forge provider abstraction (GitHub, GitLab, Forgejo adapters). Redis Streams job queue + event bus behind `QueueAdapter`/`EventBus` interfaces. Permissions layer (policy, cost-guard, tool-filter, credential-redactor) — designed but not wired into agent runtime. In-memory Prometheus metrics collector — no producers. ~12.5k LOC. | Evaluate |
| 7 | **shared** | `packages/shared` | Cross-cutting utilities: error hierarchy, structured JSON logger, AES encryption, model catalog (`MODEL_DEFS`), stream event types, request IDs, webhook signature verification. ~1.5k LOC. | Evaluate |
| 8 | **ui** | `packages/ui` | Shared React hooks/utils for chat UI: `AssistantPart` types, `appendStreamEvent()`, diff utils, expanded-view/reasoning/todo contexts. ~714 LOC. | Evaluate |
| 9 | **skills** | `packages/skills` | Agent skill pipeline: parse markdown frontmatter, resolve builtin/user/repo skills, provisioning. 12 builtin skill files (implement, refactor, react-best-practices, etc.). ~501 LOC src + ~7.6k LOC markdown. | Evaluate |
| 10 | **sandbox** | `packages/sandbox` | Isolated code execution. HTTP server in Docker (bash exec, file ops, git, snapshots, verify). Path security, git policy, disk usage, process management. ExeDev VM provider adapter. ~2.7k LOC + Dockerfile. | Evaluate |
| 11 | **render-client** | `packages/render-client` | Render.com API client for agent deploy tools. Service/postgres/redis CRUD, deploys, logs, env vars. Hardcoded plan pricing table for cost estimates. ~390 LOC. | Evaluate |

### Infrastructure & Config

| # | Module | Path | Summary | Status |
|---|--------|------|---------|--------|
| 12 | **Docker Compose** | `docker-compose.yml` | Local dev: Postgres 16 (:5433), Redis 7 (:6380), sandbox (:3001). | Evaluate |
| 13 | **Render Blueprint** | `render.yaml` | Production deploy: web, agent worker, sandbox, gateway, Redis, Postgres. | Evaluate |
| 14 | **Infrastructure** | `infrastructure/` | Forgejo setup, MinIO, runner Docker/registration scripts. | Evaluate |
| 15 | **Docs** | `docs/` | Architecture doc, ADRs, environment guide, capability list. | Evaluate |
| 16 | **Tests** | `tests/` | ~10 test files: gateway MCP tests (~814 LOC), sandbox, chat reducer, CI parser, mirror engine. Thin coverage for ~49k LOC codebase. | Evaluate |

### Key Subsystems (cross-cutting)

| # | Subsystem | Where | Summary | Status |
|---|-----------|-------|---------|--------|
| 17 | **Auth** | `apps/web/lib/auth/`, `apps/gateway/src/middleware/auth.ts` | Multi-layer: NextAuth v5 (GitHub OAuth + credentials), gateway API key auth (SHA-256 hashed), `GATEWAY_API_SECRET` admin bypass with user impersonation, sandbox shared secret. JWT carries forge token + type. | Evaluate |
| 18 | **Permissions** | `packages/platform/src/permissions/` | Policy engine with cost-guard, tool-filter, credential-redactor. Clean interfaces. **Not wired into runtime** — exported but never called by agent/gateway/web. | Evaluate |
| 19 | **Cost tracking** | `packages/db` (schema), `packages/platform/src/services/org.ts` | `usage_events` table: no writers. `agent_runs.promptTokens/completionTokens`: written. `agent_runs.costUsd`: never populated. `CostBadge` component: built but unused. `DEFAULT_QUOTA` hardcoded. | Evaluate |
| 20 | **Observability** | `packages/shared/lib/logger.ts`, `packages/platform/src/observability/metrics.ts` | Structured JSON logging (used). Prometheus metrics collector (no producers). No OpenTelemetry, no distributed tracing. Request IDs exist but partial propagation. Metrics endpoint open if `OBSERVABILITY_SECRET` unset. | Evaluate |
| 21 | **Job queue** | `packages/platform/src/queue/`, `packages/platform/src/events/` | Redis Streams for job queue (at-least-once, consumer groups, dead letter). Redis Streams + pub/sub for run event streaming. `QueueAdapter` and `EventBus` interfaces allow swapping to Postgres. | Evaluate |
| 22 | **Forge providers** | `packages/platform/src/forge/` | Abstraction over GitHub, GitLab, Forgejo APIs for git, PR, CI operations. Factory pattern. GitHub is primary; Forgejo/GitLab adapters exist. | Evaluate |
| 23 | **Forgejo coupling** | Schema, auth, bootstrap, migrations | `forgejoUserId`/`forgejoUsername` on `users` table. `forgeUserId ?? 0` for GitHub users. Bootstrap creates `forge-admin` with default password. Migration default `forge_type = 'forgejo'`. Naming drift from GitHub-first pivot. | Evaluate |

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

### R1: Remove Vercel AI SDK — Own the LLM Layer

**Scope:** `apps/agent/src/`

Replace `generateText()` / `tool()` / `@ai-sdk/*` with:
- A ~100-line agentic loop: call provider API → check for tool_use → dispatch tools → append results → repeat
- Provider adapters for Anthropic (`/api/messages` SSE) and OpenAI (`/chat/completions` SSE)
- Token-level streaming through the existing Redis pub/sub pipeline (currently step-level only)
- Direct token counting and cost calculation at the HTTP boundary
- Own tool definition format (Zod schema + execute function — same shape, no SDK wrapper)

**Key files to change:**
- `apps/agent/src/agent.ts` — replace `generateText` with owned loop
- `apps/agent/src/models.ts` — replace `createAnthropic`/`createOpenAI` with HTTP adapters
- `apps/agent/src/tools/*.ts` (~30 files) — replace `tool()` wrapper with own definition
- `apps/agent/src/tool-registry.ts` — update tool set construction
- `apps/agent/src/tools/task.ts` — replace nested `generateText` for subagents
- `apps/agent/package.json` — remove `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`
- Root `package.json` — remove `@ai-sdk/react` from catalog

**Migration for `model_messages`:** The DB stores AI SDK `ModelMessage[]` as JSONB for multi-turn context. Define our own message format and write a migration/adapter for existing data.

**Unlocks:** Token streaming, cost instrumentation, observability hooks, reduced dependency surface.

---

### R2: UI Refactor — Focus on Chat

**Scope:** `apps/web/`, `packages/ui/`

Strip the UI down to a focused chat product:

**Keep:**
- Session chat experience (with token-level streaming from R1)
- Session list / management
- Auth (GitHub OAuth sign-in)
- API key / LLM key settings
- Cost visibility per session and per user

**Remove or defer:**
- Repo browser (`/[owner]/[repo]/*` — tree, blob, edit, commits, commit, settings) — link to GitHub instead
- Org admin pages (`/orgs/[org]/members`, `/orgs/[org]/usage`)
- Activity feed (`/activity`)
- Search page (`/search`)
- Mirror management (`/settings/mirrors`)
- Shared session view (`/shared/[id]`)
- Invite flow (simplify to env-based or CLI)

**Improve:**
- Token-level streaming in chat (wired to R1)
- Tool call rendering (keep and polish existing renderers)
- Cost display per session (wire `agent_runs.promptTokens/completionTokens` + calculated cost)
- Session sidebar with quick navigation
- Performance: fewer routes, less JS, faster load

**Target:** ~5 routes (chat, sessions, settings, sign-in, maybe projects), ~20-30 components.

---

### R3: Cost Control — Build the Pipeline

**Scope:** `packages/platform/`, `packages/db/`, `apps/agent/`

Build working cost control end-to-end:

1. **Instrument the LLM layer** (depends on R1): Every API call records `{ userId, orgId, sessionId, runId, model, provider, promptTokens, completionTokens, costUsd, latencyMs, timestamp }` to Postgres.
2. **Populate `usage_events`:** Write to the existing table (or redesign it) on every LLM call.
3. **Calculate `costUsd`:** Use per-model token pricing (maintain a pricing table). Write to `agent_runs.costUsd` (change from text to numeric).
4. **Wire cost-guard:** Connect `packages/platform/src/permissions/cost-guard.ts` to the agent enqueue path. Check budget before dispatching.
5. **Per-user and per-org budgets:** Replace `DEFAULT_QUOTA` hardcoded values with configurable limits in the `orgs` or a new `budgets` table.
6. **Dashboard query surface:** Expose cost aggregation queries (by user, by org, by model, by time period) via gateway API endpoints. Wire into the simplified UI.

---

### R4: Observability — Postgres as Warehouse

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

### R5: Clean Up Forgejo Coupling

**Scope:** `packages/db/`, `apps/web/lib/auth/`, `apps/gateway/`, `packages/platform/`

1. **Rename schema columns:** `users.forgejoUserId` → `users.externalProviderId`, `users.forgejoUsername` → `users.externalUsername` (or similar). Write a Drizzle migration.
2. **Fix `forgeUserId ?? 0`:** Remove the fallback that assigns `0` to GitHub-only users.
3. **Fix migration default:** `sessions.forge_type` should default to `'github'`, not `'forgejo'`.
4. **Remove Forgejo bootstrap as default:** Admin setup should not assume Forgejo. Keep credentials provider for admin, remove `forge-admin` user creation.
5. **Generalize naming:** JWT fields, auth types, gateway middleware — rename `forgeUserId`/`forgejoUsername` references throughout.
6. **Keep Forgejo adapter:** The forge provider abstraction (`packages/platform/src/forge/`) is fine. Forgejo support stays as an adapter option, just not the default.

---

### R6: Remove Dead Code

**Scope:** Entire codebase

1. **Remove `@ai-sdk/react`** from root catalog (already unused).
2. **Remove `CostBadge` component** (built but never imported).
3. **Remove deprecated `createRedisClient()`** in `apps/web/lib/redis.ts`.
4. **Deduplicate migrations:** Resolve two `0001_*` and two `0002_*` migration files.
5. **Remove unwired Forgejo infrastructure** scripts if not needed.
6. **Remove `packages/ui` duplication** with `packages/shared/hooks` — consolidate.
7. **Remove unused gateway README claims** (stale docs about "planned" features that are already built).
8. **Audit and remove** any other unused exports, dead imports, orphaned files.

---

### R7: Rename to coding-agents

**Scope:** Entire codebase

1. **Package scope:** `@openforge/*` → `@coding-agents/*` (or `@codingagents/*`).
2. **Root package name:** `openforge` → `coding-agents`.
3. **Render services:** `openforge-web` → `coding-agents-web`, etc.
4. **Docker compose:** Update service names.
5. **CLI binary:** `forge` → `coding-agents` (or `ca`).
6. **Docs, README, environment guide:** Update all references.
7. **GitHub repo:** Rename if applicable.

---

### R8: Improve Test Coverage

**Scope:** Entire codebase

Current: ~10 test files for ~49k LOC. Target areas:

1. **Agent loop** (after R1): Test the owned agentic loop, tool dispatch, abort handling, token streaming.
2. **Cost pipeline** (after R3): Test token counting, cost calculation, budget enforcement.
3. **Platform services:** Session lifecycle, job enqueue, event streaming.
4. **Provider adapters:** Anthropic and OpenAI HTTP adapter tests with recorded responses.
5. **Gateway routes:** Expand beyond MCP tests to cover session CRUD, streaming, webhooks.

---

## Dependency Graph

```
R1 (Remove AI SDK)
├── R3 (Cost Control) — needs owned LLM layer for instrumentation
├── R4 (Observability) — needs owned LLM layer for call-level logging
└── R2 (UI Refactor) — needs token streaming from R1

R5 (Forgejo Cleanup) — independent
R6 (Dead Code) — independent, can happen anytime
R7 (Rename) — do last, after churn settles
R8 (Tests) — follows R1, R3, R4
```

Suggested execution order: R6 → R5 → R1 → R2 + R3 + R4 (parallel) → R8 → R7

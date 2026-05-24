# Research: Parallel Agents Infrastructure

**Date**: 2026-05-22 | **Feature**: 007-parallel-agents-infra

## Existing Implementation Inventory

### Already Implemented (schema + scaffolding)

| Component | Location | Status |
|-----------|----------|--------|
| Workspace columns on `projects` | `packages/db/schema/org.ts` | Schema exists: `environmentConfig`, `secretsConfig`, `computeDefaults`, `defaultSkills`, `repoMirrorStatus`, `lastMirrorSyncedAt` |
| `projectRepos` table | `packages/db/schema/org.ts` | Multi-repo association exists |
| Mirror/worktree sandbox endpoints | `apps/sandbox/server/server.ts` | `/mirror/ensure`, `/mirror/fetch`, `/worktree/create`, `/worktree/remove` |
| Mirror manager service | `apps/sandbox/server/services/mirror-manager.ts` | `ensureMirror()`, `createWorktree()`, `removeWorktree()`, `startPeriodicSync()` |
| Multi-repo workspace setup | `apps/agent/src/agent.ts` | `setupWorkspace()` with mirror+worktree path and clone fallback |
| V2 event types | `packages/shared/src/stream-types.ts` | `StreamEventV2` with `agent:message`, `agent:tool_call`, `session:completed`, etc. |
| Event publishing | `packages/platform/src/events/run-stream.ts` | `publishRunEvent()` → XADD + PUBLISH |
| SSE endpoint | `apps/web/app/api/sessions/[id]/stream/route.ts` | Replay + live subscription |
| Cancellation | `run:{runId}:abort` key + 500ms polling | Exists in agent loop |
| Job schema workspace fields | `packages/platform/src/queue/job-queue.ts` | `repos[]`, `workspaceId`, `resolvedEnv`, `resolvedSecrets` |
| Agent run phases | `packages/db/schema/session.ts` | `phase` field on `agentRuns` (SessionPhase enum) |

### Needs Completion / Hardening

| Gap | What exists | What's needed |
|-----|-------------|---------------|
| Workspace config inheritance | Columns exist, job schema has fields | Wire inheritance in `SessionService.create()` and `startAgentJob()` — pull from `projects` when creating session |
| Secrets tier enforcement | `secretsConfig` schema has `{ env, runtime, build }` | Agent must inject env tier into LLM context, strip runtime tier from LLM context (pass to terminal only), build tier to Docker builds |
| Fetch-on-start freshness | `ensureMirror()` does initial clone | Add `git fetch` step before `createWorktree()` in agent setup |
| 24h idle mirror cron | `startPeriodicSync()` exists | Verify interval, ensure it only syncs idle mirrors (no recent session) |
| Corruption detection + recovery | Not implemented | Health check on mirror before worktree creation; delete + re-clone on failure |
| GitHub webhook → mirror fetch | Not implemented | New webhook route that triggers `mirror/fetch` on push events |
| Concurrency increase | `MAX_CONCURRENT_RUNS = 5` | Change to 10, verify memory/CPU budget |
| Planning phase events | Not in v2 types | Add `planner:message`, `planner:context`, `plan:generated`, `user:plan_approved` |
| Steering events | `user:interrupt` partially exists (abort key) | Formal `user:message` during execution, agent consumption between iterations |
| Backward-compatible SSE | `normalizeEvent()` exists | Verify old event types still work for existing consumers |
| Planning/approval flow | `phase` field exists on runs | New planner module that generates plan, emits event, waits for approval before executing |

## Decisions

### 1. Workspace Inheritance Strategy

**Decision**: Eager resolution at job enqueue time.

**Rationale**: When a session starts, `startAgentJob()` already resolves `repos[]`, `resolvedEnv`, `resolvedSecrets` from workspace/project config. This is the correct pattern — the job payload is self-contained and doesn't require the worker to query the DB for workspace config. Extend this to also resolve `defaultSkills` and `instructions`.

**Alternatives considered**:
- Lazy resolution (worker queries DB) — rejected: adds DB dependency to worker, breaks self-contained job model
- Hybrid (some eager, some lazy) — rejected: complexity without benefit

### 2. Mirror Freshness: Fetch-on-Start

**Decision**: Call sandbox `/mirror/fetch` before `/worktree/create` in `setupWorkspace()`.

**Rationale**: Guarantees zero staleness at the cost of ~200ms (no-op fetch when webhook already synced) to ~5s (pending commits). Acceptable tradeoff since the alternative (stale code) causes agent errors.

**Implementation**: In `apps/agent/src/agent.ts`, after `ensureMirror()` succeeds, call `adapter.mirrorFetch(workspaceId, repoUrl)` before `adapter.createWorktree()`.

**Alternatives considered**:
- Trust webhook only — rejected: webhook gaps leave stale mirrors
- Conditional fetch (check last sync time) — rejected: adds complexity, savings marginal

### 3. Corruption Detection

**Decision**: Validate mirror health via `git rev-parse --git-dir` before worktree creation. On failure, delete mirror directory and trigger re-clone.

**Rationale**: Git provides a fast validation primitive. Treating mirrors as disposable cache means the simplest recovery (delete + re-clone) is also the most reliable.

**Implementation**: In `mirror-manager.ts`, add `validateMirror(mirrorPath)` that runs `git rev-parse --git-dir` and `git fsck --no-full` (quick structural check). On failure, `rm -rf mirrorPath` and return a flag so the caller falls back to clone.

### 4. Steering Delivery Mechanism

**Decision**: Reuse the existing Redis Pub/Sub channel (`run:{runId}`) for steering events. Agent subscribes to its own run channel and checks for `user:message` / `user:interrupt` between loop iterations.

**Rationale**: The channel already exists for SSE fan-out. Adding the agent as a subscriber to its own run's channel is zero-cost infrastructure. Polling interval (currently 500ms for abort key) provides the latency budget.

**Alternatives considered**:
- Separate steering channel — rejected: adds complexity, no benefit
- Redis List (BLPOP) — rejected: already used for `ask_user` replies; mixing concerns
- Direct HTTP to agent — rejected: agent isn't addressable (background worker)

**Implementation**: Extend `createMergedAbortController()` to also subscribe to `run:{runId}` and queue `user:message` events into a local buffer. The agent loop checks this buffer at the top of each iteration (same place it checks abort).

### 5. Planning Flow Architecture

**Decision**: Planning is a special agent run phase with restricted tools. Same `agentLoop` but with plan-only tool set (read-only: grep, read, glob, search — no write/exec). Emits `plan:generated` event and transitions to `paused` status awaiting `user:plan_approved`.

**Rationale**: Reuses 100% of existing infrastructure (job queue, worker slots, crash recovery, event streaming). No new services. The `phase` field on `agentRuns` already supports this.

**Implementation**:
1. New `SessionPhase.PLANNING` value
2. Planning run uses `buildPlanningToolSet()` (read-only subset)
3. On plan completion, emit `plan:generated` event, set run status to `paused`
4. Web endpoint `/api/sessions/{id}/approve-plan` sets `user:plan_approved` event
5. Agent resumes: status → `running`, phase → `EXECUTION`, full tool set

### 6. Event Taxonomy Migration

**Decision**: Additive. New event types are added alongside existing ones. The `normalizeEvent()` function in shared already handles v1→v2 translation. Old consumers continue to work; new consumers use the full taxonomy.

**Rationale**: Zero-downtime migration. No breaking changes to existing SSE subscribers.

**Implementation**: Extend `StreamEventV2` union type with new planning/steering types. SSE endpoint already passes through any valid `StreamEventV2`.

### 7. Concurrency Increase (5 → 10)

**Decision**: Change `MAX_CONCURRENT_RUNS` to 10 in `worker.ts`. Monitor memory usage per run (~150MB baseline + LLM context).

**Rationale**: Sub-second setup means runs aren't blocked on workspace creation. Each run is primarily I/O-bound (waiting on LLM API). 10 concurrent LLM streams is well within typical rate limits.

**Risk**: Memory. At ~200MB per active run, 10 runs = 2GB. Worker instances should have at least 4GB RAM. Current Render instance types support this.

## Technology Choices

| Choice | Selected | Why |
|--------|----------|-----|
| Mirror storage | Bare git clone on persistent disk | Sub-second worktree creation, git-native, already implemented |
| Session isolation | Git worktrees (branch per session) | Independent branches, shared object store, no file conflicts |
| Event transport | Redis Streams + Pub/Sub (existing) | Already proven, XADD for durability, PUBLISH for real-time fan-out |
| Steering delivery | Redis Pub/Sub (run channel) | Zero new infrastructure, <500ms delivery |
| Planner execution | Same agent worker loop | Reuses crash recovery, LLM tooling, event streaming |
| Secrets encryption | Existing `ENCRYPTION_KEY` mechanism | Already in place for GitHub tokens |
| Concurrency model | Event loop + async (Bun) | Single-threaded, I/O-bound workload (LLM API calls) |

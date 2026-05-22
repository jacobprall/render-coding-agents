# Tasks: Parallel Agents Infrastructure

**Input**: Design documents from `/specs/007-parallel-agents-infra/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Not explicitly requested. Test tasks omitted.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Schema migrations, shared type definitions, and configuration changes needed before any feature work.

- [ ] T001 Create `mirrors` table schema in packages/db/schema/org.ts with status, disk_path, last_fetched_at, last_session_used_at, size_bytes, error_message columns
- [ ] T002 [P] Create `webhook_subscriptions` table schema in packages/db/schema/org.ts with project_id, repo_path, webhook_id, webhook_secret, status, last_delivery_at columns
- [ ] T003 Run schema migration via `bun run db:push` to apply new tables
- [ ] T004 [P] Extend `StreamEventV2` union type in packages/shared/src/stream-types.ts with planning events (planner:message, planner:context, plan:generated, user:plan_approved, user:plan_rejected)
- [ ] T005 [P] Extend `StreamEventV2` union type in packages/shared/src/stream-types.ts with steering events (user:message with messageId, user:interrupt with action)
- [ ] T006 [P] Extend `StreamEventV2` union type in packages/shared/src/stream-types.ts with step events (step:started, step:completed, step:failed with stepId/stepType/durationMs)
- [ ] T007 [P] Add `PLANNING` and `EXECUTION` values to SessionPhase enum in packages/db/schema/session.ts (alongside existing phase values)
- [ ] T008 [P] Add environment variables to .env.example: MAX_CONCURRENT_RUNS=10, MIRROR_IDLE_SYNC_INTERVAL_MS=86400000, GITHUB_WEBHOOK_SECRET, PLANNING_ENABLED=false

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core services and patterns that MUST be complete before user story implementation.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T009 Create workspace service in packages/platform/src/services/workspace.ts with CRUD operations (getWorkspaceConfig, resolveWorkspaceForSession) that queries projects + projectRepos + secrets
- [ ] T010 [P] Create event type registry in packages/platform/src/events/event-types.ts that exports typed event constructors for all v2 event types (planning, execution, steering, lifecycle)
- [ ] T011 [P] Create steering channel interface in packages/platform/src/interfaces/events.ts extending EventBus with sendSteering(runId, event) and onSteering(runId, callback) methods
- [ ] T012 Implement steering channel in packages/platform/src/events/run-stream.ts using existing Redis Pub/Sub channel (run:{runId}) — publish steering events, subscribe and filter by user: prefix
- [ ] T013 Update MAX_CONCURRENT_RUNS from 5 to 10 in apps/agent/src/worker.ts (read from env with fallback)

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 — Configure Multi-Repo Workspace (Priority: P1) 🎯 MVP

**Goal**: Developers can configure workspaces with multiple repos, secrets (3-tier), and skills that are inherited by all agent sessions.

**Independent Test**: Create a workspace with 2+ repos, configure secrets at workspace level, start a session, and verify it inherits all config without manual setup.

### Implementation for User Story 1

- [ ] T014 [US1] Update resolveWorkspaceConfig() in packages/platform/src/services/session.ts to pull environmentConfig, secretsConfig, defaultSkills, instructions from projects table when projectId is set
- [ ] T015 [US1] Update startAgentJob() in packages/platform/src/services/session-agent-jobs.ts to populate job.resolvedEnv from workspace environmentConfig + secrets.env tier
- [ ] T016 [US1] Update startAgentJob() in packages/platform/src/services/session-agent-jobs.ts to populate job.resolvedSecrets from secrets.runtime tier (kept separate from resolvedEnv)
- [ ] T017 [P] [US1] Update startAgentJob() to populate job.activeSkillRefs from workspace defaultSkills merged with session overrides in packages/platform/src/services/session-agent-jobs.ts
- [ ] T018 [P] [US1] Update startAgentJob() to populate job.instructions from workspace instructions field in packages/platform/src/services/session-agent-jobs.ts
- [ ] T019 [US1] Implement secrets tier enforcement in apps/agent/src/agent.ts: inject resolvedEnv into system prompt context, inject resolvedSecrets into terminal env only (prefix __SECRET__), strip __SECRET__ values from LLM context in tool result processing
- [ ] T020 [US1] Update buildSystemPromptForJob() in apps/agent/src/agent.ts to include workspace instructions and environment variables in the system prompt block
- [ ] T021 [US1] Verify workspace isolation: ensure sessions with different projectIds receive only their workspace's secrets — add guard in setupWorkspace() that validates job.workspaceId matches session.projectId

**Checkpoint**: Workspace config inheritance and 3-tier secrets are functional. Sessions inherit config from workspace.

---

## Phase 4: User Story 2 — Sub-Second Agent Workspace Setup (Priority: P1) 🎯 MVP

**Goal**: Agent sessions set up workspaces in <1s using git worktrees from persistent bare clone mirrors, with fetch-on-start freshness and corruption recovery.

**Independent Test**: Start an agent session against a workspace with a pre-synced mirror and measure time from session creation to first tool invocation (<1s).

### Implementation for User Story 2

- [ ] T022 [US2] Add mirrorFetch() method to sandbox adapter in apps/sandbox/adapter.ts that calls POST /mirror/fetch
- [ ] T023 [US2] Update setupWorkspace() in apps/agent/src/agent.ts to call adapter.mirrorFetch() after ensureMirror() succeeds and before createWorktree() — guaranteeing freshness on every session start
- [ ] T024 [US2] Add mirror health validation in apps/sandbox/server/services/mirror-manager.ts: validateMirror(mirrorPath) runs `git rev-parse --git-dir` and `git fsck --no-full`, returns { healthy: boolean, error?: string }
- [ ] T025 [US2] Integrate validation into ensureMirror() in apps/sandbox/server/services/mirror-manager.ts — run validateMirror() before returning ready status; on failure, set status to corrupted
- [ ] T026 [US2] Implement corruption recovery in apps/sandbox/server/services/mirror-manager.ts: recoverMirror(workspaceId, repoPath, cloneUrl) deletes corrupted mirror directory, resets DB status to pending, triggers background re-clone
- [ ] T027 [US2] Update setupWorkspace() in apps/agent/src/agent.ts to handle corrupted mirror response — fall back to direct GitHub clone for current session, log degraded-performance event via publishEvent()
- [ ] T028 [P] [US2] Add POST /mirror/validate endpoint in apps/sandbox/server/server.ts that calls validateMirror() and returns health status, size, and lastFetchedAt
- [ ] T029 [P] [US2] Add POST /mirror/recover endpoint in apps/sandbox/server/server.ts that triggers recoverMirror() and returns 202 with estimated duration
- [ ] T030 [P] [US2] Add GET /mirror/status endpoint in apps/sandbox/server/server.ts that lists all mirrors with health, disk usage, and idle detection timestamps
- [ ] T031 [US2] Update startPeriodicSync() in apps/sandbox/server/services/mirror-manager.ts to use MIRROR_IDLE_SYNC_INTERVAL_MS (default 24h) and only sync mirrors where last_session_used_at is null or older than interval
- [ ] T032 [US2] Update mirrors table record on each session start: set last_session_used_at = now() in apps/sandbox/server/services/mirror-manager.ts when createWorktree() is called
- [ ] T033 [US2] Emit step:started and step:completed events during workspace setup in apps/agent/src/agent.ts for each phase (mirror_check, mirror_fetch, worktree_create) with durationMs
- [ ] T034 [US2] Update cleanupWorktrees() in apps/agent/src/agent.ts to handle multi-repo cleanup — iterate all worktrees created for the session and call adapter.removeWorktree() for each

**Checkpoint**: Sub-second workspace setup works end-to-end. Mirrors are validated, freshened on start, and recover from corruption.

---

## Phase 5: User Story 3 — Real-Time Granular Progress Streaming (Priority: P2)

**Goal**: The system streams structured, typed events for all session phases, enabling the frontend to show detailed progress timelines.

**Independent Test**: Start a session and verify the SSE stream delivers typed events (step:started, agent:tool_call, session:completed) that can be rendered as a progress timeline.

### Implementation for User Story 3

- [ ] T035 [US3] Update publishEvent() in apps/agent/src/run-persistence.ts to use the new event type registry from packages/platform/src/events/event-types.ts for type-safe event construction
- [ ] T036 [US3] Emit step:started/step:completed events for all workspace setup operations (already done in T033) — verify they flow through SSE endpoint correctly
- [ ] T037 [P] [US3] Add backward compatibility layer in apps/web/app/api/sessions/[id]/stream/route.ts: translate new event types to legacy format for old consumers using existing normalizeEvent() — verify old types (token, tool_call, done, error) still work
- [ ] T038 [P] [US3] Add backward compatibility layer in apps/gateway/src/routes/stream.ts: same translation logic as web SSE endpoint
- [ ] T039 [US3] Verify the full event flow: agent emits v2 event → XADD to run:{runId}:events → PUBLISH to run:{runId} → SSE delivers to browser — confirm all new types (step:*, planner:*, user:*) are passed through correctly
- [ ] T040 [US3] Add session:cancelled event emission in apps/agent/src/agent.ts when a run is aborted (supplement existing "aborted" event with structured session:cancelled type and reason)

**Checkpoint**: All session events stream to the frontend. Backward compatibility maintained for existing consumers.

---

## Phase 6: User Story 4 — Mid-Flight Steering (Priority: P2)

**Goal**: Developers can send messages or interrupts to active agent sessions that are processed between LLM iterations.

**Independent Test**: Start a session, send a mid-flight message via the API, verify the agent acknowledges it in its next iteration.

### Implementation for User Story 4

- [ ] T041 [US4] Create POST /api/sessions/[id]/steer/route.ts in apps/web/app/api/sessions/[id]/steer/ — validates active run, publishes user:message or user:interrupt event via steering channel, returns eventId
- [ ] T042 [US4] Extend createMergedAbortController() in apps/agent/src/agent.ts to subscribe to run:{runId} pub/sub channel and buffer incoming user:message events in a local queue
- [ ] T043 [US4] Add checkSteering() function in apps/agent/src/loop.ts that reads from the steering buffer at the top of each loop iteration — if user:message found, inject content as a system-level context message for the next LLM call
- [ ] T044 [US4] Handle user:interrupt events in createMergedAbortController() — treat as equivalent to abort key being set (same behavior as existing stop, but via structured event)
- [ ] T045 [P] [US4] Add POST /v1/sessions/:id/steer endpoint in apps/gateway/src/routes/stream.ts mirroring the web API steering endpoint for CLI/MCP consumers
- [ ] T046 [US4] Emit acknowledgement event (agent:message with content indicating steering received) after agent processes a steering message in apps/agent/src/loop.ts

**Checkpoint**: Mid-flight steering works. User messages are delivered and acknowledged by the agent within 2 seconds.

---

## Phase 7: User Story 5 — Planning and Approval Flow (Priority: P3)

**Goal**: The system generates a plan before execution and waits for user approval, using the same agent worker infrastructure.

**Independent Test**: Start a session with planning enabled, verify plan:generated event is emitted, approve via API, confirm execution begins.

### Implementation for User Story 5

- [ ] T047 [US5] Create planning tool set builder in apps/agent/src/planner.ts — buildPlanningToolSet() returns read-only tools (grep, read, glob, search) with no write/exec capabilities
- [ ] T048 [US5] Create planning run handler in apps/agent/src/planner.ts — runPlanningPhase(job, adapter, events) that uses agentLoop with planning tool set and a plan-generation system prompt
- [ ] T049 [US5] Emit plan:generated event at end of planning phase in apps/agent/src/planner.ts with { steps: PlanStep[], summary: string } payload, then set run status to paused
- [ ] T050 [US5] Update runAgentTurn() in apps/agent/src/agent.ts to check job.phase — if PLANNING, call runPlanningPhase() instead of runTurn()
- [ ] T051 [US5] Create POST /api/sessions/[id]/approve-plan/route.ts in apps/web/app/api/sessions/[id]/approve-plan/ — validates run is paused in planning phase, publishes user:plan_approved or user:plan_rejected event
- [ ] T052 [US5] Implement plan approval consumption in apps/agent/src/planner.ts — after emitting plan:generated and setting paused, subscribe to run channel and wait for user:plan_approved or user:plan_rejected (with timeout)
- [ ] T053 [US5] On approval: transition run status to running, phase to EXECUTION, re-enter runTurn() with full tool set in apps/agent/src/agent.ts
- [ ] T054 [US5] On rejection: set run status to completed, emit session:completed with summary indicating plan was rejected, clean up in apps/agent/src/agent.ts
- [ ] T055 [P] [US5] Add POST /v1/sessions/:id/approve endpoint in apps/gateway/src/routes/stream.ts mirroring the web API approval endpoint
- [ ] T056 [US5] Gate planning behind PLANNING_ENABLED feature flag in packages/platform/src/services/session-agent-jobs.ts — when enabled and workspace config requests planning, set job.phase = PLANNING

**Checkpoint**: Planning and approval flow works end-to-end. Plans are generated, presented, and execution only begins after approval.

---

## Phase 8: User Story 6 — GitHub Webhook Mirror Sync (Supporting)

**Goal**: GitHub push events trigger mirror fetches so mirrors stay fresh between sessions.

**Independent Test**: Simulate a GitHub push webhook payload, verify the corresponding mirror gets fetched.

### Implementation for User Story 6

- [ ] T057 [US6] Create POST /api/webhooks/github/push/route.ts in apps/web/app/api/webhooks/github/ — verify X-Hub-Signature-256 using GITHUB_WEBHOOK_SECRET, parse push event, identify matching project repos
- [ ] T058 [US6] Implement webhook handler logic: for each matched repo, call sandbox /mirror/fetch endpoint via sandbox client in apps/web/app/api/webhooks/github/push/route.ts
- [ ] T059 [P] [US6] Update webhook_subscriptions table when a new projectRepo is added — create subscription record with webhook_secret in packages/platform/src/services/workspace.ts
- [ ] T060 [US6] Update mirrors table last_fetched_at after successful webhook-triggered fetch in apps/sandbox/server/services/mirror-manager.ts

**Checkpoint**: Webhook-driven mirror sync keeps mirrors fresh in real-time.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Hardening, documentation, and improvements across all stories.

- [ ] T061 [P] Add structured logging for all mirror operations (ensure, fetch, validate, recover) in apps/sandbox/server/services/mirror-manager.ts using JSON format with correlation IDs
- [ ] T062 [P] Add structured logging for workspace setup timing in apps/agent/src/agent.ts — log total setup duration and per-step breakdown
- [ ] T063 [P] Add disk usage monitoring to GET /mirror/status in apps/sandbox/server/server.ts — include total mirror disk usage vs available capacity, emit warning event if >80% full
- [ ] T064 [P] Update apps/web/lib/sandbox-client.ts with typed methods for new mirror endpoints (validate, recover, status)
- [ ] T065 Handle disk-full edge case in apps/sandbox/server/services/mirror-manager.ts — check available disk before clone, return error with actionable message if insufficient space
- [ ] T066 Handle concurrent webhook syncs on same mirror in apps/sandbox/server/services/mirror-manager.ts — use file-based lock (lockfile) to prevent parallel git fetch on same bare clone
- [ ] T067 Handle secrets rotation for active sessions in packages/platform/src/services/workspace.ts — document that rotation takes effect on next session (active sessions use snapshotted values)
- [ ] T068 Run quickstart.md validation — verify all commands in specs/007-parallel-agents-infra/quickstart.md work end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **User Story 1 (Phase 3)**: Depends on Phase 2 — workspace config inheritance
- **User Story 2 (Phase 4)**: Depends on Phase 2 — mirror hardening (can run parallel with US1)
- **User Story 3 (Phase 5)**: Depends on Phase 2 + partially on US2 (step events from T033)
- **User Story 4 (Phase 6)**: Depends on Phase 2 + T012 (steering channel)
- **User Story 5 (Phase 7)**: Depends on Phase 2 + US3 (event streaming) + US4 (steering for approval wait)
- **User Story 6 (Phase 8)**: Depends on Phase 2 + US2 (mirror infrastructure)
- **Polish (Phase 9)**: Depends on all stories being complete

### User Story Dependencies

- **US1 (Workspace Config)**: Can start after Phase 2 — fully independent
- **US2 (Sub-Second Setup)**: Can start after Phase 2 — fully independent from US1
- **US3 (Event Streaming)**: Can start after Phase 2 — references step events from US2 (T033) but can be tested independently
- **US4 (Steering)**: Can start after Phase 2 + T012 — independent from US1/US2/US3
- **US5 (Planning)**: Depends on US3 (events) + US4 (steering for approval) — start after those
- **US6 (Webhooks)**: Can start after Phase 2 — references mirror infra but can be tested independently

### Within Each User Story

- Schema/types before services
- Services before endpoints
- Core implementation before integration
- Emit events after core logic works

### Parallel Opportunities

- T001/T002 (schema tables) can run in parallel
- T004/T005/T006/T007/T008 (type definitions) can all run in parallel
- T009/T010/T011/T013 (foundational services) can run in parallel after schema
- US1 and US2 can run in complete parallel after Phase 2
- US3 and US4 can run in parallel after Phase 2
- T028/T029/T030 (new sandbox endpoints) can all run in parallel
- T037/T038 (backward compat layers) can run in parallel
- T045/T055 (gateway mirroring) can run in parallel with their web counterparts

---

## Parallel Example: User Stories 1 + 2

```bash
# After Phase 2 completes, launch US1 and US2 in parallel:

# Agent 1: User Story 1 (Workspace Config)
Task: "T014 Update resolveWorkspaceConfig() in packages/platform/src/services/session.ts"
Task: "T015 Update startAgentJob() for resolvedEnv in packages/platform/src/services/session-agent-jobs.ts"
Task: "T019 Implement secrets enforcement in apps/agent/src/agent.ts"

# Agent 2: User Story 2 (Sub-Second Setup)
Task: "T022 Add mirrorFetch() to sandbox adapter in apps/sandbox/adapter.ts"
Task: "T024 Add mirror validation in apps/sandbox/server/services/mirror-manager.ts"
Task: "T031 Update periodic sync in apps/sandbox/server/services/mirror-manager.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2)

1. Complete Phase 1: Setup (schema + types)
2. Complete Phase 2: Foundational (workspace service, event registry, concurrency)
3. Complete Phase 3: US1 — Workspace config inheritance + secrets
4. Complete Phase 4: US2 — Sub-second setup with fetch-on-start + recovery
5. **STOP and VALIDATE**: Test workspace creation → session start → <1s setup → secrets inherited
6. Deploy as MVP

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 + US2 (parallel) → Test independently → **Deploy MVP**
3. US3 (Event Streaming) → Test SSE shows all new types → Deploy
4. US4 (Steering) → Test mid-flight message delivery → Deploy
5. US5 (Planning) → Test plan → approve → execute flow → Deploy (behind feature flag)
6. US6 (Webhooks) → Test push → mirror fetch → Deploy
7. Polish → Hardening complete

### Parallel Agent Strategy

With multiple agents:

1. All agents complete Setup + Foundational together
2. Once Foundational is done:
   - Agent A: User Story 1 (workspace config)
   - Agent B: User Story 2 (mirror hardening)
   - Agent C: User Story 3 (event streaming) — can start once types are ready
3. After US3 + US4:
   - Agent D: User Story 5 (planning flow)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Architecture.md is source of truth for approach — all tasks align with its decisions
- Much of the scaffolding already exists (see research.md) — tasks focus on wiring, hardening, and completing

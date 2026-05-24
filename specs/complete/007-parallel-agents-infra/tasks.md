# Tasks: Parallel Agents Infrastructure

**Input**: Design documents from `/specs/007-parallel-agents-infra/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Not explicitly requested. Test tasks omitted.

**Organization**: Tasks grouped by user story and trimmed to the real implementation gap.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Minimal setup for the remaining implementation gaps.

- [x] T001 Update worker concurrency default to 10 in `apps/agent/src/worker.ts` using `MAX_CONCURRENT_RUNS` env fallback
- [x] T002 [P] Add missing planning/steering/step event variants to `packages/shared/lib/stream-types.ts` (`planner:*`, `plan:*`, `user:*`, `step:*`)
- [x] T003 [P] Add/refresh planning and sync env vars in `.env.example` (`MAX_CONCURRENT_RUNS`, `MIRROR_IDLE_SYNC_INTERVAL_MS`, `GITHUB_WEBHOOK_SECRET`, `PLANNING_ENABLED`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared plumbing needed by multiple user stories.

**⚠️ CRITICAL**: User story work starts after this phase.

- [x] T004 Implement steering publish/subscribe helpers in `packages/platform/src/events/run-stream.ts` on existing `run:{runId}` channel
- [x] T005 [P] Extend `EventBus` contract in `packages/platform/src/interfaces/events.ts` with typed steering methods used by web/gateway and agent
- [x] T006 [P] Verify and tune idle mirror sync interval logic to 24h in `apps/sandbox/server/services/mirror-manager.ts` (without changing existing mirror health/recovery behavior)

**Checkpoint**: Shared event + sync primitives ready.

---

## Phase 3: User Story 1 - Configure Multi-Repo Workspace (Priority: P1) 🎯 MVP

**Goal**: Sessions inherit workspace configuration and enforce three-tier secret behavior.

**Independent Test**: Create workspace with env/runtime/build secrets, start session, verify only allowed values appear in LLM context while runtime secrets remain terminal-only.

### Implementation for User Story 1

- [x] T007 [US1] Audit and finalize workspace inheritance wiring in `packages/platform/src/services/session.ts` for `environmentConfig`, `secretsConfig`, `defaultSkills`, and `instructions`
- [x] T008 [US1] Ensure job payload resolution is complete in `packages/platform/src/services/session-agent-jobs.ts` (`resolvedEnv`, `resolvedSecrets`, `activeSkillRefs`, `instructions`)
- [x] T009 [US1] Enforce secret redaction boundary in `apps/agent/src/agent.ts` so `__SECRET__`-prefixed runtime secrets are never surfaced back into assistant-visible tool output

**Checkpoint**: Workspace inheritance and secret boundaries are correct.

---

## Phase 4: User Story 2 - Sub-Second Agent Workspace Setup (Priority: P1) 🎯 MVP

**Goal**: Maintain existing fast mirror/worktree path while adding explicit setup progress and freshness guarantees.

**Independent Test**: Start session on pre-existing mirror and confirm setup events are emitted and setup remains sub-second in steady state.

### Implementation for User Story 2

- [x] T010 [US2] Emit `step:started` / `step:completed` events for workspace setup stages in `apps/agent/src/agent.ts` (`mirror_check`, `mirror_fetch`, `worktree_create`, `fallback_clone`)
- [x] T011 [US2] Make mirror freshness explicit by ensuring setup path invokes fetch semantics before worktree creation in `apps/agent/src/agent.ts` (without duplicating existing `ensureMirror` behavior)
- [x] T012 [P] [US2] Expose mirror health/status endpoint wiring in `apps/sandbox/server/server.ts` using existing `mirror-manager` health data (no duplicate recovery implementation)
- [x] T013 [US2] Add degraded-setup telemetry enrichment in `apps/agent/src/agent.ts` for fallback clone cases (repo, reason, duration)

**Checkpoint**: Setup remains fast, observable, and operationally clear.

---

## Phase 5: User Story 3 - Real-Time Granular Progress Streaming (Priority: P2)

**Goal**: New typed events appear in SSE while preserving backward compatibility.

**Independent Test**: Subscribe to session stream and verify both new namespaced events and legacy-normalized output still render correctly.

### Implementation for User Story 3

- [x] T014 [US3] Update event mapping in `apps/agent/src/run-persistence.ts` so new planning/steering/step events are serialized consistently as v2 payloads
- [x] T015 [US3] Validate backward compatibility in `apps/web/app/api/sessions/[id]/stream/route.ts` and `apps/gateway/src/routes/stream.ts` for old consumers while passing through new event types

**Checkpoint**: Event taxonomy expansion is visible and non-breaking.

---

## Phase 6: User Story 4 - Mid-Flight Steering of Agent Sessions (Priority: P2)

**Goal**: User messages/interrupts are delivered mid-run and acted on between loop iterations.

**Independent Test**: Send steering message to active run and verify acknowledgement/action in the next loop iteration.

### Implementation for User Story 4

- [x] T016 [US4] Create steering endpoint `apps/web/app/api/sessions/[id]/steer/route.ts` to publish `user:message` / `user:interrupt` events to the active run
- [x] T017 [US4] Consume steering events in agent execution flow by extending `apps/agent/src/agent.ts` and `apps/agent/src/loop.ts` to read queued messages between iterations
- [x] T018 [P] [US4] Add gateway parity endpoint in `apps/gateway/src/routes/stream.ts` for non-web clients to send steering events

**Checkpoint**: Mid-flight steering works end-to-end across web and gateway surfaces.

---

## Phase 7: User Story 5 - Planning and Approval Flow (Priority: P3)

**Goal**: Planning runs on the agent worker, pauses for approval, then proceeds to execution.

**Independent Test**: Enable planning mode, receive `plan:generated`, approve plan, and observe transition to execution without starting a new run.

### Implementation for User Story 5

- [x] T019 [US5] Create planning module in `apps/agent/src/planner.ts` with read-only toolset and plan-generation output
- [x] T020 [US5] Integrate planning phase switch in `apps/agent/src/agent.ts` so runs enter planning mode, emit `plan:generated`, and pause awaiting approval
- [x] T021 [US5] Create approval endpoint `apps/web/app/api/sessions/[id]/approve-plan/route.ts` that publishes `user:plan_approved` / `user:plan_rejected`
- [x] T022 [P] [US5] Add gateway parity approval route in `apps/gateway/src/routes/stream.ts`

**Checkpoint**: Planning/approval lifecycle functions on existing worker/event infrastructure.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final hardening and documentation validation across all stories.

- [x] T023 [P] Add targeted observability fields for setup/steering/planning transitions in `apps/agent/src/agent.ts` and `apps/sandbox/server/services/mirror-manager.ts`
- [x] T024 Run and document quickstart validation updates in `specs/007-parallel-agents-infra/quickstart.md` to reflect final task outcomes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Starts immediately
- **Phase 2 (Foundational)**: Depends on Phase 1; blocks story work
- **US1 (Phase 3)** and **US2 (Phase 4)**: Can run in parallel after Phase 2 (MVP)
- **US3 (Phase 5)**: Starts after Phase 1/2; benefits from US2 setup event emission
- **US4 (Phase 6)**: Depends on Phase 2 steering primitives
- **US5 (Phase 7)**: Depends on US3 event typing and US4 steering channel behavior
- **Polish (Phase 8)**: After target stories are complete

### User Story Dependencies

- **US1**: Independent after foundational phase
- **US2**: Independent after foundational phase
- **US3**: Independent after foundational phase, validates both old and new stream behavior
- **US4**: Independent after foundational phase
- **US5**: Depends on event/steering infrastructure from US3/US4

### Parallel Opportunities

- T002 and T003 can run in parallel
- T005 and T006 can run in parallel
- US1 and US2 can be executed in parallel for MVP
- T018 and T022 (gateway parity routes) can run in parallel with web route work

---

## Parallel Example: MVP Stories (US1 + US2)

```bash
# After foundational tasks complete:
Task: "T007 Audit workspace inheritance wiring in packages/platform/src/services/session.ts"
Task: "T010 Emit setup step events in apps/agent/src/agent.ts"
Task: "T009 Enforce secret redaction boundary in apps/agent/src/agent.ts"
Task: "T012 Expose mirror health/status endpoint wiring in apps/sandbox/server/server.ts"
```

---

## Implementation Strategy

### MVP First

1. Complete Phase 1 + Phase 2
2. Complete US1 and US2 in parallel
3. Validate workspace inheritance + sub-second setup
4. Ship MVP

### Incremental Delivery

1. Add US3 (event taxonomy visibility + compatibility)
2. Add US4 (mid-flight steering)
3. Add US5 (planning + approval)
4. Finish polish and quickstart validation

### Scope Note

This task list intentionally excludes capabilities already implemented (mirror health/recovery internals, worktree cleanup, base SSE replay pipeline) and focuses only on remaining architecture-spec gaps.

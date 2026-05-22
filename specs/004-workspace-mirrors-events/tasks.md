# Tasks: Workspace Model, Repo Mirrors & Event Taxonomy

**Input**: Design documents from `specs/004-workspace-mirrors-events/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Not explicitly requested. Test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Monorepo**: `apps/` (deployable services), `packages/` (shared libraries)
- Schema: `packages/db/schema/`
- Platform services: `packages/platform/src/services/`
- Shared types: `packages/shared/lib/`
- Agent: `apps/agent/src/`
- Sandbox: `apps/sandbox/server/`
- Gateway routes: `apps/gateway/src/routes/`
- Web app: `apps/web/`
- Migrations: `apps/web/lib/db/migrations/`

---

## Phase 1: Setup

**Purpose**: Schema migration, shared types, and foundational infrastructure

- [ ] T001 Create database migration file for workspace model extensions in `apps/web/lib/db/migrations/NNNN_workspace_model.sql` — add `environment_config`, `secrets_config`, `compute_defaults`, `default_skills`, `repo_mirror_status`, `last_mirror_synced_at` to `projects` table
- [ ] T002 Create database migration for session extensions in `apps/web/lib/db/migrations/NNNN_workspace_model.sql` — add `session_env_overrides`, `session_skills_overrides`, `repos_used`, `summary` to `sessions` table
- [ ] T003 Create database migration for `mirror_sync_log` table in `apps/web/lib/db/migrations/NNNN_workspace_model.sql` — new table with indexes
- [ ] T004 [P] Update Drizzle schema for projects table in `packages/db/schema/org.ts` — add workspace columns matching the migration
- [ ] T005 [P] Update Drizzle schema for sessions table in `packages/db/schema/session.ts` — add override and summary columns
- [ ] T006 [P] Create Drizzle schema for `mirror_sync_log` table in `packages/db/schema/org.ts` — new table definition with types
- [ ] T007 [P] Export new types from `packages/db/schema.ts` — ensure `MirrorSyncLog`, updated `Project`, `Session` types are re-exported

**Checkpoint**: Schema ready — `bun run db:push` applies workspace model to database

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core services and types that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T008 Create workspace config resolution service in `packages/platform/src/services/workspace.ts` — `resolveWorkspaceConfig(projectId)` loads project, merges env/secrets/skills, returns resolved config
- [ ] T009 Add secret encryption/decryption helpers to `packages/platform/src/services/workspace.ts` — encrypt secrets on write, decrypt on read using existing `ENCRYPTION_KEY` pattern from `packages/shared/lib/encryption.ts`
- [ ] T010 [P] Create `StreamEventV2` type and `normalizeEvent()` function in `packages/shared/lib/stream-types.ts` — versioned event interface with `v`, `type`, `ts`, `payload` fields; mapping function from V1 to V2
- [ ] T011 [P] Add workspace config types to `packages/shared/` — `SecretsConfig`, `RepoMirrorStatus`, `SessionSummary`, `WorkspaceConfig` interfaces
- [ ] T012 Extend job queue payload with workspace fields in `packages/platform/src/queue/job-queue.ts` — add `workspaceId`, `resolvedEnv`, `resolvedSecrets`, `resolvedSkills`, `repos` to job payload type

**Checkpoint**: Foundation ready — workspace resolution, event normalization, and job payload available for all stories

---

## Phase 3: User Story 1 — Multi-Repo Workspace Setup (Priority: P1) MVP

**Goal**: Users can attach multiple repos to a workspace and launch sessions that access all repos

**Independent Test**: Create a workspace with 3 repos, launch a session, verify agent sees all 3 repo directories

### Implementation for User Story 1

- [ ] T013 [US1] Add workspace configuration CRUD endpoints in `apps/gateway/src/routes/workspace.ts` — `GET /projects/:id/workspace`, `PUT /projects/:id/workspace` with Zod validation and org admin authorization check
- [ ] T014 [US1] Register workspace routes in `apps/gateway/src/index.ts` — import and mount `workspaceRoutes`
- [ ] T015 [US1] Update session creation in `packages/platform/src/services/session.ts` — when `projectId` is set, resolve workspace config via `resolveWorkspaceConfig()`, merge additive overrides, populate `repos_used` from project repos
- [ ] T016 [US1] Update session creation endpoint in `apps/gateway/src/routes/sessions.ts` — accept `sessionEnvOverrides` and `sessionSkillsOverrides` in request body, validate no overlap with workspace env keys
- [ ] T017 [US1] Update agent job enqueue in `packages/platform/src/services/session.ts` — pass resolved workspace config (env, secrets, skills, repo list) in job payload
- [ ] T018 [US1] Update agent worker to read workspace fields from job payload in `apps/agent/src/worker.ts` — extract resolved config and repo list, inject env vars into agent process
- [ ] T019 [US1] Update agent clone logic to handle multi-repo in `apps/agent/src/agent.ts` — iterate over job payload `repos[]`, clone each into `/workspace/{sessionId}/repos/{repoName}` instead of root
- [ ] T020 [US1] Update sandbox path handling for multi-repo layout in `apps/sandbox/server/lib/path-security.ts` — validate paths under `repos/{repoName}/` subdirectories
- [ ] T021 [US1] Implement per-repo PR creation logic in `apps/agent/src/agent.ts` — on session completion, create separate branches and PRs for each repo that has changes

**Checkpoint**: User Story 1 fully functional — multi-repo workspaces with config inheritance and per-repo PRs

---

## Phase 4: User Story 2 — Sub-Second Session Setup via Repo Mirrors (Priority: P1)

**Goal**: Sessions create git worktrees from persistent bare clone mirrors instead of cloning from GitHub

**Independent Test**: Launch a session against a repo with an existing mirror, measure time to first tool call is <3s

### Implementation for User Story 2

- [ ] T022 [P] [US2] Create mirror manager service in `apps/sandbox/server/services/mirror-manager.ts` — `ensureMirror(workspaceId, repoPath, cloneUrl)`, `fetchMirror(workspaceId, repoPath)`, `removeMirror()` with per-mirror flock-based locking
- [ ] T023 [P] [US2] Create disk monitor service in `apps/sandbox/server/services/disk-monitor.ts` — `getDiskStatus()`, `evictLRU(threshold)` with configurable thresholds, `getAlertLevel()`
- [ ] T024 [US2] Create mirror HTTP handler in `apps/sandbox/server/handlers/mirror.ts` — `POST /mirror/ensure`, `POST /mirror/fetch`, `GET /disk/status` endpoints
- [ ] T025 [US2] Create worktree HTTP handler in `apps/sandbox/server/handlers/worktree.ts` — `POST /worktree/create`, `POST /worktree/remove` endpoints with session-scoped branch naming (`agent/{sessionId}`)
- [ ] T026 [US2] Register new handlers in sandbox server in `apps/sandbox/server/server.ts` — mount mirror and worktree routes
- [ ] T027 [US2] Add mirror/worktree methods to sandbox adapter in `apps/sandbox/adapter.ts` — `ensureMirror()`, `fetchMirror()`, `createWorktree()`, `removeWorktree()`, `getDiskStatus()` HTTP client methods
- [ ] T028 [US2] Replace clone logic with worktree-first approach in `apps/agent/src/agent.ts` — in `ensureRepoCloned()`, try `adapter.createWorktree()` first, fall back to `git clone` if mirror unavailable, emit `step:degraded` event on fallback
- [ ] T029 [US2] Add worktree cleanup on session end in `apps/agent/src/agent.ts` — call `adapter.removeWorktree()` for each repo during session finalization
- [ ] T030 [US2] Update mirror status in workspace after sync in `packages/platform/src/services/workspace.ts` — `updateMirrorStatus(projectId, repoPath, status)` writes to `repo_mirror_status` JSONB and `last_mirror_synced_at`
- [ ] T031 [US2] Add mirror sync log recording in `packages/platform/src/services/workspace.ts` — `logMirrorSync(projectId, repoPath, trigger, status, durationMs, error?)` inserts into `mirror_sync_log` table

**Checkpoint**: User Story 2 fully functional — sub-second session setup via worktrees with fallback

---

## Phase 5: User Story 3 — Workspace-Level Configuration Inheritance (Priority: P2)

**Goal**: Org admins configure workspace env vars, secrets, and skills; sessions inherit automatically

**Independent Test**: Set workspace-level config, launch two sessions, verify both inherit without per-session setup

### Implementation for User Story 3

- [ ] T032 [US3] Add authorization middleware for workspace endpoints in `apps/gateway/src/middleware/` — check `orgMembers.role` for admin-only operations, return 403 for non-admins
- [ ] T033 [US3] Implement runtime secret redaction in agent tool layer in `apps/agent/src/` — intercept tool results, strip values matching `__SECRET__`-prefixed env vars from LLM context before including in conversation
- [ ] T034 [US3] Add session summary persistence on completion in `apps/agent/src/agent.ts` — on session end, build `SessionSummary` object and write to `sessions.summary` JSONB column

**Checkpoint**: User Story 3 functional — workspace config inherited, secrets redacted, summaries persisted

---

## Phase 6: User Story 4 — Parallel Agents Sharing Workspace Resources (Priority: P2)

**Goal**: Multiple sessions on the same workspace share mirrors and config, each on isolated branches

**Independent Test**: Launch 3 sessions simultaneously against one workspace, verify no git conflicts

### Implementation for User Story 4

- [ ] T035 [US4] Add concurrent worktree safety in `apps/sandbox/server/services/mirror-manager.ts` — flock-based locking per bare clone, retry with backoff on lock contention (3 retries, 100ms backoff)
- [ ] T036 [US4] Handle simultaneous initial mirror creation in `apps/sandbox/server/services/mirror-manager.ts` — if two sessions request `ensureMirror` for same repo simultaneously, one creates while other waits on flock then succeeds with existing mirror
- [ ] T037 [US4] Verify worktree isolation in agent clone logic in `apps/agent/src/agent.ts` — ensure branch naming `agent/{sessionId}` is unique, handle `git worktree add` errors gracefully

**Checkpoint**: User Story 4 functional — parallel agents operate safely on shared workspace

---

## Phase 7: User Story 5 — Structured Event Stream for Session Monitoring (Priority: P2)

**Goal**: Event stream uses namespaced types for phase-specific progress indicators

**Independent Test**: Run a session, subscribe to SSE, verify events have `v: 2`, namespaced `type`, and `payload` structure

### Implementation for User Story 5

- [ ] T038 [US5] Update event publishing to V2 format in `apps/agent/src/run-persistence.ts` — `publishEvent()` emits `{ v: 2, type: "agent:...", ts: ISO8601, payload: {...} }` for all event types
- [ ] T039 [US5] Add setup-phase events in `apps/agent/src/agent.ts` — emit `step:started` and `step:completed` events during workspace setup (mirror ensure, worktree create, config injection) with `durationMs`
- [ ] T040 [US5] Update web SSE endpoint to normalize events in `apps/web/app/api/sessions/[id]/stream/route.ts` — call `normalizeEvent()` before sending to clients, handle both V1 (replayed) and V2 (live) events
- [ ] T041 [P] [US5] Update gateway SSE endpoint to normalize events in `apps/gateway/src/routes/stream.ts` — same normalization as web SSE
- [ ] T042 [US5] Update chat reducer to handle V2 event types in `apps/web/lib/ui/lib/chat-parts.ts` — map `agent:message` → token display, `agent:tool_call` → tool UI, `session:completed` → terminal state
- [ ] T043 [US5] Update terminal event detection in `apps/web/app/api/sessions/[id]/stream/route.ts` and `apps/gateway/src/routes/stream.ts` — recognize both V1 (`done`, `error`, `aborted`) and V2 (`session:completed`, `session:failed`) as terminal events
- [ ] T044 [US5] Add `step:degraded` event emission in `apps/agent/src/agent.ts` — emit when mirror fallback to GitHub clone occurs, include reason and expected delay

**Checkpoint**: User Story 5 functional — structured event stream with phase-level observability

---

## Phase 8: User Story 6 — Graceful Degradation (Priority: P3)

**Goal**: System falls back to GitHub clone when mirror unavailable, creates mirror for next time

**Independent Test**: Delete a mirror, start a session, verify clone completes and mirror is created

### Implementation for User Story 6

- [ ] T045 [US6] Add mirror creation after fallback clone in `apps/agent/src/agent.ts` — after successful GitHub clone fallback, call `adapter.ensureMirror()` in background to create bare clone for future sessions
- [ ] T046 [US6] Add corrupted mirror detection in `apps/sandbox/server/services/mirror-manager.ts` — run `git fsck --no-full` on mirror access, if corrupted delete and re-clone
- [ ] T047 [US6] Implement periodic mirror sync cron in `apps/sandbox/server/services/mirror-manager.ts` — scheduled task (every 4 hours) fetches all mirrors, logs results to `mirror_sync_log`

**Checkpoint**: User Story 6 functional — robust fallback with self-healing mirrors

---

## Phase 9: Webhook & Mirror Sync Integration

**Purpose**: Connect GitHub webhooks to mirror sync and add disk management

- [ ] T048 [P] Extend webhook handler for push events in `apps/gateway/src/routes/webhooks.ts` — on `push` event, look up all workspaces with matching repo in `project_repos`, trigger `POST /mirror/fetch` on sandbox for each
- [ ] T049 [P] Add mirror status API endpoint in `apps/gateway/src/routes/workspace.ts` — `GET /projects/:id/mirrors` returning per-repo mirror status and disk usage
- [ ] T050 Add manual mirror sync endpoint in `apps/gateway/src/routes/workspace.ts` — `POST /projects/:id/mirrors/sync` triggering fetch for all workspace repos
- [ ] T051 Implement LRU eviction in disk monitor in `apps/sandbox/server/services/disk-monitor.ts` — evict least-recently-used mirrors when disk > 80%, skip mirrors with active worktrees, emit alerts at 70% (warning) and 85% (critical)
- [ ] T052 Add event stream retention trim job in `packages/platform/src/events/run-stream.ts` — hourly trim of Redis Streams entries older than 7 days using `XTRIM MINID`

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T053 [P] Add structured logging for mirror operations in `apps/sandbox/server/services/mirror-manager.ts` — JSON logs with correlation IDs per constitution principle II
- [ ] T054 [P] Add structured logging for workspace config resolution in `packages/platform/src/services/workspace.ts` — log config resolution, secret injection (redacted), override merges
- [ ] T055 Validate quickstart.md scenarios end-to-end — run through all curl examples in `specs/004-workspace-mirrors-events/quickstart.md` against local dev
- [ ] T056 Update gateway OpenAPI/Zod schemas for new workspace endpoints in `apps/gateway/src/routes/workspace.ts` — ensure all request/response shapes match contracts/api.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema must exist) — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — multi-repo workspace setup
- **US2 (Phase 4)**: Depends on Phase 2 — can run in parallel with US1
- **US3 (Phase 5)**: Depends on Phase 2 — can run in parallel with US1/US2
- **US4 (Phase 6)**: Depends on US2 (mirror manager must exist) — extends concurrency safety
- **US5 (Phase 7)**: Depends on Phase 2 (event types) — can run in parallel with US1-US4
- **US6 (Phase 8)**: Depends on US2 (mirror/worktree infrastructure)
- **Webhook/Sync (Phase 9)**: Depends on US2 + US6
- **Polish (Phase 10)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (Multi-Repo)**: Foundational only — independent
- **US2 (Repo Mirrors)**: Foundational only — independent, can parallel with US1
- **US3 (Config Inheritance)**: Foundational only — independent, can parallel with US1/US2
- **US4 (Parallel Agents)**: Depends on US2 (mirror manager)
- **US5 (Event Taxonomy)**: Foundational only — independent
- **US6 (Graceful Degradation)**: Depends on US2 (mirror infrastructure)

### Within Each User Story

- Schema/types before services
- Services before handlers/endpoints
- Agent-side before sandbox-side (where agent calls sandbox)
- Core implementation before edge case handling

### Parallel Opportunities

- T004, T005, T006, T007 can all run in parallel (different schema files)
- T010, T011 can run in parallel with T008, T009 (different packages)
- T022, T023 can run in parallel (different sandbox services)
- T040, T041 can run in parallel (different SSE endpoints)
- T048, T049 can run in parallel (different gateway routes)
- US1, US2, US3, US5 can all start in parallel after Phase 2

---

## Parallel Example: User Story 2

```bash
# Launch sandbox services in parallel (different files):
Task: "Create mirror manager service in apps/sandbox/server/services/mirror-manager.ts"
Task: "Create disk monitor service in apps/sandbox/server/services/disk-monitor.ts"

# Then handlers (depend on services):
Task: "Create mirror HTTP handler in apps/sandbox/server/handlers/mirror.ts"
Task: "Create worktree HTTP handler in apps/sandbox/server/handlers/worktree.ts"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2)

1. Complete Phase 1: Setup (schema migration)
2. Complete Phase 2: Foundational (workspace service, event types, job payload)
3. Complete Phase 3: US1 — Multi-repo workspace setup
4. Complete Phase 4: US2 — Repo mirrors + worktrees
5. **STOP and VALIDATE**: Test multi-repo with sub-second setup independently
6. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (Multi-Repo) → Test independently → Deploy (multi-repo MVP)
3. Add US2 (Mirrors) → Test independently → Deploy (performance upgrade)
4. Add US3 (Config) + US5 (Events) in parallel → Test → Deploy
5. Add US4 (Parallel Safety) + US6 (Degradation) → Test → Deploy
6. Add Webhook integration + Polish → Final release

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Migrations T001-T003 can be combined into a single migration file

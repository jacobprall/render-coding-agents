# Feature Specification: Parallel Agents Infrastructure

**Feature Branch**: `007-parallel-agents-infra`

**Created**: 2026-05-22

**Status**: Draft

**Input**: Architecture decision record for Epic 1 — Parallel Agents & Dev Environments. Three evolutionary changes: (1) Workspace model promoting projects to persistent workspaces with multi-repo support, (2) Persistent bare clone mirrors with git worktrees for sub-second agent setup, (3) Unified event taxonomy formalizing the Redis Streams event bus with structured planning/execution/steering phases.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Multi-Repo Workspace (Priority: P1)

A developer creates or updates a workspace that groups multiple repositories (e.g., frontend, backend, shared-libs) under a single project. They configure shared environment variables, secrets, and agent skills that apply to all sessions spawned within that workspace.

**Why this priority**: The workspace model is the foundational primitive that all other changes depend on. Without workspace-level ownership of repos and config, parallel agents and shared mirrors have no coordination point.

**Independent Test**: Can be fully tested by creating a workspace with 2+ repos, configuring secrets at workspace level, and verifying a new session inherits the configuration without manual setup.

**Acceptance Scenarios**:

1. **Given** a user has an existing project with one repo, **When** they add a second repository to the workspace, **Then** both repos are accessible in subsequent agent sessions.
2. **Given** a workspace has environment variables configured, **When** a new agent session starts, **Then** the session inherits all workspace-level environment variables without user intervention.
3. **Given** a workspace has runtime secrets configured, **When** an agent session runs, **Then** secrets are available in the terminal but redacted from LLM context.
4. **Given** a workspace has skills and rules configured, **When** a new session starts, **Then** workspace-default skills are loaded automatically.

---

### User Story 2 - Sub-Second Agent Workspace Setup (Priority: P1)

A developer triggers an agent session (or multiple parallel sessions) against a workspace. Instead of waiting 10-30 seconds per repo clone, the system creates git worktrees from persistent bare clone mirrors in under one second, so agents begin working almost immediately.

**Why this priority**: Workspace setup latency directly impacts developer experience and is the primary bottleneck for parallel agent workflows. Moving from 10-30s to <1s unlocks practical multi-agent usage.

**Independent Test**: Can be tested by starting an agent session against a workspace with a pre-synced mirror and measuring the time from session creation to agent readiness (first tool invocation).

**Acceptance Scenarios**:

1. **Given** a workspace repo has a synced bare clone mirror on disk, **When** an agent session starts, **Then** the workspace is ready (worktree created, files accessible) in under 1 second.
2. **Given** a workspace repo has never been mirrored, **When** an agent session starts, **Then** the system performs a full clone from GitHub (fallback) and logs a degraded-performance event, completing setup within the expected 10-30s range.
3. **Given** multiple parallel agent sessions start simultaneously for the same workspace, **When** each session needs the same repo, **Then** each gets an independent worktree from the shared mirror without contention or corruption.
4. **Given** a push event occurs on GitHub, **When** the webhook fires, **Then** the bare clone mirror fetches the new commits within 60 seconds of the push.
5. **Given** an agent session completes or is cancelled, **When** cleanup runs, **Then** the git worktree is removed and disk is reclaimed.

---

### User Story 3 - Real-Time Granular Progress Streaming (Priority: P2)

A developer monitors one or more active agent sessions via the UI. The system streams structured events covering planning, execution steps, tool calls, and lifecycle transitions, enabling the UI to show detailed progress for each phase.

**Why this priority**: Structured events enable the planning/approval flow, mid-flight steering, and observability dashboards. However, agent execution already works without formalized events — this adds visibility rather than core capability.

**Independent Test**: Can be tested by starting a session and verifying the SSE stream delivers typed events (step:started, agent:tool_call, session:completed) that the frontend can render as a progress timeline.

**Acceptance Scenarios**:

1. **Given** an agent session begins workspace setup, **When** each setup step (mirror check, worktree creation) completes, **Then** the frontend receives `step:started` and `step:completed` events with duration.
2. **Given** an agent is executing and makes a tool call, **When** the tool call starts and finishes, **Then** `agent:tool_call` and `agent:tool_result` events are emitted in order.
3. **Given** a session completes successfully, **When** the PR is created, **Then** a `session:completed` event with `prUrl` is emitted.
4. **Given** a session fails, **When** the error is captured, **Then** a `session:failed` event with error details is emitted.

---

### User Story 4 - Mid-Flight Steering of Agent Sessions (Priority: P2)

A developer sends a message or issues an interrupt to an active agent session. The system delivers this as a structured steering event that the agent processes between LLM iterations, allowing course corrections without restarting the session.

**Why this priority**: Steering extends the existing abort-key pattern into a richer interaction model. It significantly improves the developer's ability to guide agents, but the platform functions without it.

**Independent Test**: Can be tested by starting a session, sending a mid-flight message via the UI, and verifying the agent acknowledges and incorporates the guidance in its next iteration.

**Acceptance Scenarios**:

1. **Given** an agent is executing, **When** the user sends a message, **Then** a `user:message` event is delivered and the agent acknowledges it within the next iteration.
2. **Given** an agent is executing, **When** the user sends an interrupt/cancel, **Then** a `user:interrupt` event is delivered and the agent stops within 2 seconds.

---

### User Story 5 - Planning and Approval Flow (Priority: P3)

A developer initiates a task. Before autonomous execution, the system's planner generates a plan and presents it for approval. The developer can approve, reject, or modify the plan before the executor begins work.

**Why this priority**: This is a higher-level workflow that builds on the event taxonomy and workspace model. It adds safety and control for complex tasks but is not required for basic parallel agent functionality.

**Independent Test**: Can be tested by initiating a task, verifying a `plan:generated` event is emitted with steps, approving it via `user:plan_approved`, and confirming the executor begins only after approval.

**Acceptance Scenarios**:

1. **Given** a user submits a task, **When** planning mode is enabled, **Then** the planner generates and streams a plan before any code changes occur.
2. **Given** a plan is generated, **When** the user approves it, **Then** execution begins within 2 seconds of approval.
3. **Given** a plan is generated, **When** the user rejects it, **Then** no execution occurs and the user can provide revised instructions.

---

### Edge Cases

- What happens when the persistent disk is full and a new mirror cannot be created?
- How does the system handle concurrent webhook syncs on the same bare clone mirror?
- What happens when a worktree creation fails due to a corrupted bare clone? (Resolved: delete corrupted mirror, fall back to GitHub clone for current session, re-create mirror in background.)
- How does the system handle a session that references a repo removed from the workspace?
- What happens when multiple agents attempt to write to overlapping files across parallel sessions? (Resolved: isolated branches; conflicts surfaced at merge/PR time.)
- How does the system handle secrets rotation while active sessions are running?
- What happens when the webhook endpoint is unreachable and the mirror becomes stale beyond the periodic sync interval?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support multiple repositories per workspace, with each repo independently configured and accessible to agent sessions.
- **FR-002**: System MUST maintain persistent bare clone mirrors of all workspace repos on the sandbox's persistent disk, updated via GitHub webhooks.
- **FR-003**: System MUST create agent session workspaces using git worktrees from local bare clone mirrors, achieving sub-second setup when mirrors are available.
- **FR-004**: System MUST fall back to a full clone from GitHub when a bare clone mirror is unavailable, logging a degraded-performance event.
- **FR-005**: System MUST perform a git fetch on the bare clone mirror at session start (before worktree creation) to ensure freshness, and run a 24-hour background cron fetch on idle mirrors as a safety net for missed webhooks.
- **FR-006**: System MUST support three tiers of secrets at workspace level: environment variables (visible to LLM), runtime secrets (redacted from LLM, visible in terminal), and build secrets (available only during image builds).
- **FR-007**: System MUST emit structured, typed events for all session phases: planning, execution (steps, tool calls, messages), steering (user messages, interrupts), and lifecycle (completed, failed).
- **FR-008**: System MUST deliver steering events (user messages, interrupts) to active agent sessions within 2 seconds of submission.
- **FR-009**: System MUST clean up git worktrees when a session ends (completion, failure, or cancellation).
- **FR-010**: System MUST allow concurrent agent sessions within the same workspace without contention on shared resources (mirrors, config).
- **FR-011**: System MUST detect corrupted bare clone mirrors and recover automatically by deleting and re-cloning from GitHub in the background, while the current session falls back to a direct GitHub clone.
- **FR-012**: System MUST maintain backward compatibility with existing SSE event consumers during the event taxonomy migration.
- **FR-013**: System MUST support workspace-level inheritance of skills, rules, and environment configuration for all sessions.
- **FR-014**: System MUST provide a planning/approval flow where agents can generate a plan and wait for user approval before executing. Planning runs on the agent worker (same execution path as execution), consuming a worker slot during the planning phase.

### Key Entities

- **Workspace**: A persistent grouping of repositories, configuration, secrets, and compute defaults owned by an organization. Sessions inherit from their workspace.
- **Repo Mirror**: A bare git clone stored on the sandbox's persistent disk, kept in sync with the GitHub remote via webhooks and periodic fetches.
- **Session**: A lightweight, task-scoped work unit that creates worktrees from workspace mirrors and inherits workspace configuration.
- **Event**: A typed, timestamped message on the Redis Streams event bus with a namespace (planning, execution, steering, lifecycle) and structured payload.
- **Secret**: A configuration value with one of three visibility tiers (environment, runtime, build), attached at the workspace level.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Agent session workspace setup completes in under 1 second when bare clone mirrors are available (down from 10-30 seconds today).
- **SC-002**: System supports at least 10 concurrent agent sessions per worker instance without resource contention or degraded performance (up from 5 today).
- **SC-003**: All session events (planning, execution, steering, lifecycle) are delivered to the frontend within 500ms of occurrence.
- **SC-004**: Bare clone mirrors are always fresh at session start (fetch-on-start guarantees zero staleness for active use); idle mirrors drift no more than 24 hours between background syncs.
- **SC-005**: Steering interrupts halt agent execution within 2 seconds of user submission.
- **SC-006**: Zero data leakage between workspaces — sessions from different workspaces never access another workspace's secrets or mirrors.
- **SC-007**: Fallback clone (when mirror unavailable) completes within the same time budget as today's implementation (10-30s) and does not block other sessions.

## Clarifications

### Session 2026-05-22

- Q: When multiple agents modify the same file across parallel sessions, how are conflicts handled? → A: Isolated branches; conflicts detected at merge/PR time, surfaced to user for resolution.
- Q: What is the mirror sync strategy and periodic fallback interval? → A: Three-layer freshness: (1) webhooks for real-time sync, (2) git fetch on every session start before worktree creation, (3) 24-hour background cron for idle mirrors with no recent sessions.
- Q: Should the planner agent run on the web service or the agent worker? → A: Agent worker. Unified execution path reusing existing LLM tooling, crash recovery, and event infrastructure.
- Q: What is the target concurrency limit per worker instance? → A: 10 concurrent sessions per instance (up from 5 today). Enables parallel workflows without resource exhaustion.
- Q: How does the system recover from a corrupted bare clone mirror? → A: Delete and re-clone from GitHub. Mirrors are treated as disposable cache; current session falls back to GitHub clone while mirror is re-created in background.

## Assumptions

- The existing sandbox persistent disk has sufficient capacity for bare clone mirrors of all active workspace repos (typical corporate repos average 200MB-1GB bare).
- GitHub webhook delivery is reliable under normal conditions; periodic sync provides a safety net for the ~1% of missed deliveries.
- The existing Redis Streams infrastructure has sufficient throughput for the expanded event taxonomy without requiring scaling changes.
- The existing agent worker concurrency limit (5 concurrent runs) will be increased to 10 per instance as part of this work, given sub-second setup removes the previous bottleneck.
- Existing SSE consumers will be migrated to the new event format within a single release cycle; backward compatibility is temporary.
- Agent sessions create branches scoped to their session ID, preventing git conflicts between parallel agents on the same repo.
- Build secrets (tier 3) require Docker/BuildKit support already present in the sandbox environment.

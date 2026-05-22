# Feature Specification: Workspace Model, Repo Mirrors & Event Taxonomy

**Feature Branch**: `004-workspace-mirrors-events`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "Evolve the agent platform with three foundational changes: (1) promote projects to workspaces that own repos, config, secrets, and skills across sessions with multi-repo support; (2) maintain persistent bare clone repo mirrors on the sandbox disk with webhook sync so agent sessions use git worktrees for sub-second setup; (3) formalize the Redis Streams event bus with a structured event taxonomy covering planning, execution, and steering phases."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Multi-Repo Workspace Setup (Priority: P1)

A team lead configures a workspace that spans three repositories: a frontend app, a backend API, and a shared library. They attach all three repos to a single workspace so that any agent session launched against that workspace can read and write across all three.

**Why this priority**: Multi-repo is the core capability gap. Without it, agents cannot work on tasks that cross repository boundaries — the most common real-world scenario for full-stack teams.

**Independent Test**: Can be fully tested by creating a workspace, attaching multiple repos, launching a session, and verifying the agent can access files from all attached repos. Delivers immediate value for cross-repo tasks.

**Acceptance Scenarios**:

1. **Given** a workspace with zero repos attached, **When** a user adds three GitHub repositories to the workspace, **Then** all three appear in the workspace's repo list and are available to future sessions.
2. **Given** a workspace with three repos, **When** a new agent session starts, **Then** the session's working directory contains separate directories for each repo, all on isolated branches.
3. **Given** a workspace with repos A and B, **When** an agent edits a file in repo A and references a type from repo B, **Then** both changes are accessible within the same session without switching context.
4. **Given** a workspace with repos A and B, **When** an agent completes a task that modified files in both repos, **Then** separate PRs are created for each repo, each on its own branch.

---

### User Story 2 - Sub-Second Session Setup via Repo Mirrors (Priority: P1)

A developer kicks off a new agent session against a large monorepo. Instead of waiting 20+ seconds for a fresh GitHub clone, the session starts in under one second because a persistent bare clone mirror already exists on disk.

**Why this priority**: Session startup latency directly impacts user experience and agent throughput. Cutting setup from 10-30s to <1s is a 10-30x improvement that compounds with parallel agents.

**Independent Test**: Can be tested by launching a session against a repo that already has a bare clone mirror, measuring time from session creation to agent's first tool call. Delivers immediate UX improvement.

**Acceptance Scenarios**:

1. **Given** a workspace with a synced bare clone mirror on disk, **When** a new session starts, **Then** the repo is available to the agent in under 1 second via git worktree.
2. **Given** a workspace where no mirror exists yet, **When** the first session starts, **Then** a full clone is performed (10-30s), a bare clone mirror is created, and subsequent sessions use the mirror for sub-second setup.
3. **Given** a bare clone mirror that is 2 hours stale, **When** a new session starts, **Then** the mirror is fetched before worktree creation, and the agent works against up-to-date code.

---

### User Story 3 - Workspace-Level Configuration Inheritance (Priority: P2)

An engineering manager configures environment variables, secrets, and default skills for a workspace. Every agent session launched in that workspace inherits these settings without the developer needing to reconfigure per session.

**Why this priority**: Reduces repetitive setup and ensures consistency across parallel agents. Important for teams but not as critical as the core multi-repo and performance improvements.

**Independent Test**: Can be tested by setting workspace-level config, launching two sessions, and verifying both inherit the same environment variables, secrets, and skills without explicit per-session configuration.

**Acceptance Scenarios**:

1. **Given** an org admin has set environment variables on a workspace, **When** any org member starts a session, **Then** the agent process has those variables in its environment.
2. **Given** a non-admin org member, **When** they attempt to modify workspace configuration, **Then** the system rejects the request with an authorization error.
3. **Given** a workspace with runtime secrets configured, **When** the agent executes a terminal command that uses a secret, **Then** the secret value is available in the terminal but redacted from the LLM context.
4. **Given** a workspace with default skills attached, **When** a new session starts, **Then** the agent has access to those skills without the user selecting them.

---

### User Story 4 - Parallel Agents Sharing Workspace Resources (Priority: P2)

A developer launches three agent sessions simultaneously against the same workspace — one for the frontend, one for the backend, one for tests. All three share the same repo mirrors and workspace config, each on its own branch.

**Why this priority**: Parallel agent execution is the headline feature of Milestone 1. Depends on workspace model and repo mirrors being in place.

**Independent Test**: Can be tested by launching three sessions against one workspace, verifying each gets its own worktree/branch, and confirming they don't interfere with each other's git state.

**Acceptance Scenarios**:

1. **Given** a workspace with one repo, **When** three sessions start simultaneously, **Then** each gets an isolated git worktree from the same bare clone, on separate branches.
2. **Given** three active sessions on the same workspace, **When** one session pushes a commit, **Then** the other sessions' worktrees are unaffected.
3. **Given** three active sessions, **When** one session ends, **Then** its worktree is cleaned up without affecting the other two sessions.

---

### User Story 5 - Structured Event Stream for Session Monitoring (Priority: P2)

A developer watches a running agent session in the UI. The progress indicator shows distinct phases — planning, cloning, executing, pushing — because the event stream uses structured, namespaced event types rather than raw token streams.

**Why this priority**: Improves observability and enables future features (planning/approval flow, audit trails) but the agent functions without it. The existing ad-hoc events already work for basic streaming.

**Independent Test**: Can be tested by running a session, subscribing to the event stream, and verifying events have structured `type` and `payload` fields matching the defined taxonomy. Frontend can render phase-specific UI.

**Acceptance Scenarios**:

1. **Given** a session is starting, **When** the workspace setup phase runs, **Then** the event stream emits `step:started` and `step:completed` events with duration metadata.
2. **Given** a session is executing, **When** the agent makes a tool call, **Then** the event stream emits an `agent:tool_call` event with tool name and arguments, followed by an `agent:tool_result` event.
3. **Given** a session is active, **When** the user sends a steering message, **Then** the event stream includes a `user:message` event that the agent processes between LLM iterations.

---

### User Story 6 - Graceful Degradation When Mirror Unavailable (Priority: P3)

A session starts for a repo that was just added to the workspace. No bare clone mirror exists yet. The system falls back to a standard GitHub clone, creates the mirror for future use, and logs a degraded-performance event.

**Why this priority**: Edge case handling. Important for robustness but not the primary flow.

**Independent Test**: Can be tested by deleting a mirror from disk, starting a session, verifying clone completes from GitHub, and confirming a mirror is created for subsequent sessions.

**Acceptance Scenarios**:

1. **Given** a workspace repo with no bare clone mirror, **When** a session starts, **Then** a shallow clone from GitHub is performed and completes successfully.
2. **Given** a fallback clone occurred, **When** the clone completes, **Then** a bare clone mirror is created for future sessions and a `step:degraded` event is emitted.

---

### Edge Cases

- What happens when two sessions try to create the initial bare clone mirror for the same repo simultaneously? One should succeed, the other should wait or also fall back to GitHub clone.
- How does the system handle a corrupted bare clone mirror? Detection and automatic re-clone from GitHub.
- What happens when webhook sync fails repeatedly and the mirror becomes very stale? Periodic cron fallback fetches all mirrors on a configurable interval.
- What happens when the persistent disk fills up with bare clone mirrors? LRU eviction removes least-recently-used mirrors when disk exceeds a configurable threshold. Monitoring emits alerts at warning and critical levels.
- What happens when a workspace has repos from different GitHub organizations with different access tokens? Each repo's credentials are resolved from the workspace's configured installations.
- What happens when a worktree's branch name collides with an existing remote branch? Session branch names are prefixed with `agent/{sessionId}` to avoid collisions.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow attaching multiple GitHub repositories to a single workspace.
- **FR-002**: System MUST create isolated working directories for each attached repo when an agent session starts, each on its own branch.
- **FR-002a**: System MUST produce one PR per repo when a session modifies files across multiple repos.
- **FR-003**: System MUST maintain persistent bare clone mirrors of workspace repos on the sandbox persistent disk.
- **FR-004**: System MUST sync bare clone mirrors via GitHub webhook push events.
- **FR-005**: System MUST create git worktrees from bare clone mirrors for agent sessions instead of cloning from GitHub.
- **FR-006**: System MUST fall back to GitHub clone when no bare clone mirror exists, and create the mirror afterward.
- **FR-007**: System MUST run periodic mirror sync (cron) as a fallback for missed webhooks.
- **FR-008**: System MUST restrict workspace configuration (environment variables, secrets, repos, skills) to org admins.
- **FR-008a**: System MUST allow all org members to launch sessions against any workspace in their org.
- **FR-009**: System MUST support three-tier secrets (environment variables, runtime secrets, build secrets) at the workspace level.
- **FR-010**: System MUST redact runtime secrets from LLM context while keeping them available in terminal execution.
- **FR-011**: System MUST clean up git worktrees when agent sessions end.
- **FR-012**: System MUST emit structured events with namespaced `type` and `payload` fields for all session phases (planning, execution, steering, lifecycle).
- **FR-013**: System MUST support backward compatibility by translating existing event types to the new taxonomy during migration.
- **FR-014**: System MUST isolate parallel agent sessions on the same workspace so that git operations in one session do not affect another.
- **FR-015**: System MUST support workspace-level default skills and rules that sessions inherit.
- **FR-016**: System MUST allow sessions to add additional env vars or skills (additive overrides) without removing or modifying workspace-level values.
- **FR-017**: System MUST NOT allow sessions to override workspace-level secrets or repo configuration.
- **FR-018**: System MUST monitor sandbox disk usage and automatically evict least-recently-used mirrors when usage exceeds a configurable threshold.
- **FR-019**: System MUST emit alerts when disk usage exceeds warning and critical thresholds.
- **FR-020**: System MUST retain session events in the event stream for 7 days, then automatically expire them.
- **FR-021**: System MUST persist a session summary (outcome, duration, repos touched, PR URLs) to the database permanently when a session completes.

### Key Entities

- **Workspace**: The organizational unit (promoted from `projects`) that owns repos, config, secrets, skills, and sessions. Belongs to an Org.
- **Repo Mirror**: A persistent bare clone of a GitHub repository stored on the sandbox disk, associated with a workspace. Webhook-synced.
- **Session**: A lightweight task record that inherits configuration from its workspace. Creates worktrees from repo mirrors.
- **Worktree**: An isolated git working directory created from a bare clone mirror, scoped to a single session and branch.
- **Event**: A structured message on the Redis Streams event bus with a namespaced `type`, `payload`, and timestamp. Covers planning, execution, steering, and lifecycle phases.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Agent sessions against repos with existing mirrors start (first tool call) in under 3 seconds, down from 10-30 seconds today.
- **SC-002**: Users can configure a workspace with 3+ repositories and launch an agent session that accesses all repos within a single task.
- **SC-003**: Three parallel agent sessions on the same workspace can run simultaneously without git conflicts or data corruption.
- **SC-004**: Workspace-level environment variables and secrets are available in 100% of sessions launched against that workspace without per-session configuration.
- **SC-005**: The event stream for any session contains structured, typed events that the frontend can use to render phase-specific progress indicators.
- **SC-006**: Existing integrations (SSE streaming, dashboard, observability) continue to function during and after event taxonomy migration with no user-facing regressions.

## Clarifications

### Session 2026-05-21

- Q: When an agent modifies files across multiple repos in one session, what is the commit/PR strategy? → A: One PR per repo — each repo gets its own branch and independent PR.
- Q: Who can configure workspace-level settings (env vars, secrets, skills, repos)? → A: Org admins configure workspaces; all org members can launch sessions.
- Q: Can sessions override inherited workspace config? → A: Additive overrides only — sessions can add env vars or skills but cannot remove or modify workspace-level values.
- Q: How is mirror disk usage managed when the persistent disk fills up? → A: LRU eviction — automatically remove least-recently-used mirrors when disk exceeds a threshold, with monitoring and alerts.
- Q: How long are session events retained in the event stream? → A: Time-bounded — events retained for 7 days in Redis, session summary persisted to database permanently.

## Assumptions

- The existing sandbox service with 20GB persistent disk has sufficient initial capacity for bare clone mirrors. LRU eviction prevents disk exhaustion; disk size may need to increase based on workspace count.
- GitHub webhook delivery is reliable enough that periodic cron sync (every few hours) is an adequate fallback for missed events.
- The existing Redis Streams infrastructure has sufficient capacity for the structured event taxonomy without additional scaling.
- Git worktree operations on the sandbox's persistent disk are performant enough for sub-second session setup. NVMe or SSD-backed storage is assumed.
- The existing agent worker's concurrency limit (5 concurrent runs) is the starting point; scaling is an open question.
- Multi-repo workspaces will initially support GitHub repositories only. Other providers (GitLab, Bitbucket) are out of scope for v1.
- The three-tier secrets model does not include external secrets managers (Vault, AWS Secrets Manager) in v1. Secrets are stored encrypted in the database.

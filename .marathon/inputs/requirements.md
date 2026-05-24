# Requirements

<!-- The product backlog. Each sprint pulls the next unstarted batch from this document. -->
<!-- As sprints complete, requirements are marked [DONE]. Follow-up items are added to the bottom. -->

<!-- Status markers: -->
<!--   [TODO]        — not started, available for next sprint -->
<!--   [IN SPRINT]   — currently being worked on -->
<!--   [DONE]        — completed and verified -->
<!--   [DEFERRED]    — intentionally pushed to a later sprint -->

---

## Milestone 2: Automations (Epic 2)

<!-- Event-driven and scheduled agent automation system -->

### R1: Schedule/Cron Triggers

**Status:** [TODO]

**Description:**
Agents can be triggered on schedules — either preset intervals (every hour, daily, weekly) or custom cron expressions. Scheduled automations run unattended and produce results like any other agent session.

**User Stories:**
- As a platform user, I want to schedule agents to run on a cron so that recurring tasks (dependency updates, code health checks, report generation) happen automatically.

**Acceptance Criteria:**
- [ ] Automation entity exists in the database schema with trigger type, schedule expression, prompt, tool config, and repo binding
- [ ] Cron parser validates expressions and rejects invalid ones
- [ ] Scheduler service polls for due automations and enqueues agent jobs
- [ ] Scheduled runs produce normal agent sessions visible in the dashboard
- [ ] Automations can be paused, resumed, and deleted
- [ ] Next-run-at is calculated and visible in the UI

**Notes:**
- Use a dedicated Render cron job or a polling worker with Redis-based scheduling
- Consider timezone handling for user-facing schedule display

---

### R2: Event Triggers (GitHub/GitLab)

**Status:** [TODO]

**Description:**
Extend the existing `InboundRouter` + `InboundDispatcher` to support full automation binding — users configure trigger → prompt → tools → repos, and matching events automatically spawn agent sessions.

**User Stories:**
- As a developer, I want agents to automatically respond to PR comments, CI failures, and push events so that issues are addressed without manual intervention.

**Acceptance Criteria:**
- [ ] Automation entity can be configured with GitHub/GitLab event triggers (PR opened, pushed, merged, commented, CI completion)
- [ ] Webhook payloads are matched against automation trigger conditions
- [ ] Matched events enqueue agent jobs with the automation's configured prompt, tools, and repos
- [ ] Support for filtering (e.g., only PRs to `main`, only CI failures on specific workflows)
- [ ] Existing `InboundRouter`/`InboundDispatcher` extended (not replaced) for automation dispatch

**Notes:**
- Partially implemented: webhook handlers exist for push, PR opened/merged/commented, CI completion. Gap is the automation entity binding and condition matching.

---

### R3: Slack Event Triggers

**Status:** [TODO]

**Description:**
New Slack integration enables triggering automations from messages in connected Slack channels. A Slack app receives events and routes matching messages to the automation dispatcher.

**User Stories:**
- As a team lead, I want to trigger agent tasks by posting in a Slack channel so that non-technical team members can request agent work.

**Acceptance Criteria:**
- [ ] Slack app manifest defined with required OAuth scopes and event subscriptions
- [ ] OAuth flow for connecting Slack workspaces to the platform
- [ ] Slack event subscription endpoint receives and verifies message events
- [ ] Automation trigger type `slack_message` matches on channel, keywords, or mentions
- [ ] Matched messages enqueue agent jobs with context from the Slack message

**Notes:**
- Requires Slack App registration (Bot Token, Event Subscriptions)
- Verify requests using Slack signing secret

---

### R4: Linear Event Triggers

**Status:** [TODO]

**Description:**
Linear webhook integration enables triggering automations from Linear issue events (assigned, status changed, commented).

**User Stories:**
- As a developer, I want to delegate Linear issues to an agent so that routine implementation tasks are handled automatically.

**Acceptance Criteria:**
- [ ] Linear webhook endpoint receives issue events
- [ ] Automation trigger type `linear_issue` matches on assignment, label, status change
- [ ] Matched events enqueue agent jobs with issue context (title, description, labels)
- [ ] Support for bidirectional status sync (agent updates Linear issue status)

---

### R5: Memory Tool (Cross-Session Learning)

**Status:** [TODO]

**Description:**
Agents can store and retrieve learnings from past runs. A memory system provides RAG-like retrieval of relevant past decisions, patterns, and outcomes to inform current sessions.

**User Stories:**
- As a platform user, I want agents to learn from previous runs so that they don't repeat mistakes and improve over time.

**Acceptance Criteria:**
- [ ] Memory store (vector DB or structured JSON) persists learnings per workspace/repo
- [ ] Agents can write to memory during sessions (key decisions, error resolutions, patterns discovered)
- [ ] Agents can query memory at session start and during execution for relevant past context
- [ ] Memory is scoped: per-repo, per-workspace, or per-team
- [ ] Memory entries have TTL or relevance scoring to prevent stale information

**Notes:**
- Consider pgvector extension for PostgreSQL, or a simpler structured JSON approach initially
- Memory should be opt-in per automation/workspace

---

### R6: Automation Builder UI

**Status:** [TODO]

**Description:**
A web interface for creating, editing, and managing automations. Users configure trigger → prompt → tools → repos through a guided builder flow.

**User Stories:**
- As a platform user, I want a visual builder to create automations so that I don't need to write configuration files.

**Acceptance Criteria:**
- [ ] Automation list page showing all automations with status, trigger type, last run
- [ ] Create automation flow: choose trigger type → configure trigger conditions → write prompt → select tools → specify repos
- [ ] Edit existing automations with same flow
- [ ] Automation detail page showing run history and configuration
- [ ] Enable/disable toggle for each automation
- [ ] Delete automation with confirmation

---

### R7: BugBot Automation

**Status:** [TODO]

**Description:**
A pre-built automation that triggers on PR creation and runs automated code review — equivalent to Cursor's BugBot. Ships as a one-click enableable automation.

**User Stories:**
- As a team lead, I want automatic PR review on every PR so that code quality issues are caught early without manual reviewer assignment.

**Acceptance Criteria:**
- [ ] BugBot automation template available as one-click setup
- [ ] Triggers on PR opened/updated events
- [ ] Runs code review agent with security, correctness, and performance focus
- [ ] Posts review comments directly on the PR
- [ ] Autofix capability: spawns follow-up agent to resolve flagged issues
- [ ] Configurable rules via `.cursor/BUGBOT.md`

---

## Milestone 3: Integrations (Epic 3)

<!-- Bidirectional integrations with Slack and Linear -->

### R8: Slack Completion Notifications

**Status:** [TODO]

**Description:**
When agents complete tasks, send notifications to configured Slack channels. Extends the existing `NotificationSink` adapter with a Slack-specific implementation.

**User Stories:**
- As a developer, I want to be notified in Slack when my agent finishes so that I can review results without watching the dashboard.

**Acceptance Criteria:**
- [ ] `SlackNotificationSink` implements `NotificationSink` interface
- [ ] Configurable per-workspace: which Slack channel receives notifications
- [ ] Notifications include: session summary, PR links (if created), success/failure status
- [ ] Rich Slack message format (Block Kit) with action buttons
- [ ] Notification preferences: all completions, failures only, or specific automations

---

### R9: Slack Bidirectional Communication

**Status:** [TODO]

**Description:**
Full Slack app with OAuth, event subscriptions, and slash commands. Users can interact with agents from Slack — trigger runs, check status, and receive real-time updates.

**User Stories:**
- As a developer, I want to interact with agents from Slack so that I don't need to context-switch to the web dashboard.

**Acceptance Criteria:**
- [ ] Slack app with OAuth2 installation flow (V2 with granular scopes)
- [ ] Slash commands: `/agent run <prompt>`, `/agent status`, `/agent list`
- [ ] Real-time updates posted to thread when agent makes progress
- [ ] Thread-based conversation: reply in thread to send follow-up messages to agent
- [ ] App Home tab showing active agents and recent completions

---

### R10: Linear Issue Delegation

**Status:** [TODO]

**Description:**
Delegate Linear issues to agents via a command (comment, label, or assignment). Agent picks up the issue, implements it, and opens a PR linked back to the issue.

**User Stories:**
- As a developer, I want to assign a Linear issue to an agent so that routine implementation tasks are handled autonomously.

**Acceptance Criteria:**
- [ ] Linear OAuth app registration with required scopes
- [ ] Webhook receives issue assignment/label events
- [ ] Issue delegation triggers agent session with issue context as prompt
- [ ] Agent creates PR with Linear issue link in description
- [ ] Linear issue updated with PR link when created

---

### R11: Linear Real-Time Status

**Status:** [TODO]

**Description:**
Agents update their Linear issue status in real-time as they progress through work — from "In Progress" to "In Review" to "Done".

**User Stories:**
- As a project manager, I want to see agent progress in Linear so that the board reflects actual work status.

**Acceptance Criteria:**
- [ ] Agent session lifecycle events map to Linear status transitions
- [ ] Status updates: session started → In Progress, PR opened → In Review, PR merged → Done
- [ ] Comments posted on Linear issue with progress updates
- [ ] Error states reflected: session failed → blocked/needs-help status

---

### R12: Linear Auto-Create PRs from Issues

**Status:** [TODO]

**Description:**
When an agent completes work on a Linear issue, it automatically creates a PR with the issue linked, branch named after the issue ID, and description referencing the issue.

**User Stories:**
- As a developer, I want PRs automatically linked to their Linear issues so that traceability is maintained.

**Acceptance Criteria:**
- [ ] Branch naming convention: `agent/<issue-id>-<short-description>`
- [ ] PR title includes Linear issue ID
- [ ] PR description includes `Closes LIN-XXX` for auto-close on merge
- [ ] Linear issue gets PR link attached automatically

---

## Milestone 4: Interfaces (Epic 4)

<!-- Web UI enhancements and REST API versioning -->

### R13: Kanban Board View

**Status:** [TODO]

**Description:**
A kanban-style board view for monitoring agent progress. Columns represent agent states (queued, running, reviewing, done, failed). Cards show key info at a glance.

**User Stories:**
- As a team lead, I want a kanban view of all agents so that I can see the overall state of work at a glance.

**Acceptance Criteria:**
- [ ] Kanban board with columns: Queued, Running, In Review, Complete, Failed
- [ ] Agent cards show: task summary, repo, duration, assigned model
- [ ] Drag-and-drop to reprioritize queued agents
- [ ] Click card to open agent detail/chat view
- [ ] Real-time updates as agents move between states (SSE/WebSocket)
- [ ] Filterable by repo, automation source, date range

---

### R14: Mobile-Optimized Dashboard

**Status:** [TODO]

**Description:**
The web dashboard provides a native-feeling mobile experience for monitoring agents on the go. Responsive design with touch-optimized interactions.

**User Stories:**
- As a developer, I want to check agent status from my phone so that I can monitor progress away from my desk.

**Acceptance Criteria:**
- [ ] Responsive layout adapts to mobile viewport (< 768px)
- [ ] Touch-friendly tap targets (minimum 44x44px)
- [ ] Swipe gestures for navigation between agents
- [ ] Compact card view for agent list on mobile
- [ ] Bottom navigation bar for primary actions
- [ ] Pull-to-refresh for status updates
- [ ] Agent chat readable and scrollable on mobile

---

### R15: REST API v1 (/v1/agents)

**Status:** [TODO]

**Description:**
Versioned REST API at `/v1/agents` for programmatic agent management. Clean, documented endpoints that external tools and scripts can integrate with.

**User Stories:**
- As a developer, I want a stable versioned API so that I can build scripts and integrations against the agent platform.

**Acceptance Criteria:**
- [ ] `/v1/agents` namespace with consistent resource naming
- [ ] Endpoints: POST (create), GET (list), GET /:id (detail), POST /:id/messages (send), DELETE /:id (cancel)
- [ ] OpenAPI 3.1 spec auto-generated from Zod schemas
- [ ] Bearer token authentication (existing API key system)
- [ ] Pagination, filtering, and sorting on list endpoint
- [ ] Rate limiting with clear headers (X-RateLimit-*)
- [ ] Swagger UI available at `/v1/docs`

**Notes:**
- Gateway already exposes equivalent functionality at `/api/sessions/*`. This is a versioned, stable facade over that.

---

### R16: Web UI Polish — Session Management

**Status:** [TODO]

**Description:**
Enhanced session management in the web dashboard: bulk actions, better filtering, improved real-time updates, and session comparison.

**User Stories:**
- As a platform user, I want to efficiently manage many agent sessions so that the dashboard scales with my usage.

**Acceptance Criteria:**
- [ ] Bulk select and cancel/archive sessions
- [ ] Advanced filtering: by status, model, repo, date range, trigger source
- [ ] Session comparison view: diff two sessions' outputs side by side
- [ ] Persistent filter/sort preferences per user
- [ ] Export session history as CSV/JSON

---

## Backlog

<!-- Items deferred from completed sprints or discovered during development. -->

- Agent audit remediation (Epic 1, spec 008) — shell escape, decomposition, subagent signals [from Epic 1 close]
- VM isolation per agent (Epic 1, Milestone 1) — critical architectural decision pending [DEFERRED to infrastructure sprint]
- Git worktree management (Epic 1, Milestone 1) — blocked on VM isolation decision [DEFERRED]
- Computer User / desktop environment (Epic 1, Milestone 3) — stretch goal [DEFERRED]
- Artifacts & Demos system (Epic 1, Milestone 4) — stretch goal [DEFERRED]

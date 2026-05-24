# Feature Specification: Automation Engine

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "Build out the automation engine for scheduled and triggered automations, leveraging the existing event-driven InboundRouter/InboundDispatcher architecture. Support cron/interval schedules, GitHub/GitLab event triggers, Slack message triggers, Linear issue triggers, and generic webhooks. Include an automation entity, scheduler, adapter layer for new event sources, and BugBot as a pre-built automation template."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a Scheduled Automation (Priority: P1)

A platform user wants to set up a recurring agent task — such as a weekly dependency audit or daily code health check — that runs unattended on a cron schedule and produces results visible in the dashboard like any other agent session.

**Why this priority**: Scheduled automations are the foundational capability. Without an automation entity and scheduler, no other trigger types can function. This story exercises the full vertical slice: entity creation, schedule persistence, tick emission, and session execution.

**Independent Test**: Can be fully tested by creating an automation with a cron expression, waiting for the scheduled time, and verifying an agent session is created and completes with observable output in the dashboard.

**Acceptance Scenarios**:

1. **Given** a user is on the automations page, **When** they create an automation with trigger type "cron" and expression `0 9 * * 1` (every Monday 9am), **Then** the automation is persisted with a calculated `nextRunAt` and appears in the automation list as "enabled".
2. **Given** a cron automation exists with `nextRunAt` in the past, **When** the scheduler ticks, **Then** an agent session is created with the automation's configured prompt, tools, and repos, and `nextRunAt` is advanced to the next occurrence.
3. **Given** a running scheduled automation, **When** the user pauses it, **Then** no further sessions are created until the user resumes it, and the UI reflects the paused state.
4. **Given** a cron expression is invalid, **When** the user attempts to save, **Then** the system rejects the input with a clear validation error before persisting.

---

### User Story 2 - GitHub Event Triggers an Automation (Priority: P1)

A developer configures an automation that fires when specific GitHub events occur — such as PR opened on a target branch, CI failure on a specific workflow, or a review comment mentioning a keyword — and the platform automatically spawns an agent session to handle it.

**Why this priority**: Event triggers build on the existing InboundRouter/InboundDispatcher pipeline (which already handles GitHub webhooks). This is the natural extension point and validates the "automation as event consumer" pattern.

**Independent Test**: Can be tested by configuring an automation with a GitHub PR trigger, opening a PR on the bound repo, and verifying the automation matches the event and creates an agent session with the correct context.

**Acceptance Scenarios**:

1. **Given** an automation exists with trigger "github_event" and condition `{ event: "pr_opened", branch: "main" }`, **When** a PR targeting `main` is opened on the bound repo, **Then** an agent session is created with the PR context injected into the prompt.
2. **Given** an automation with a CI failure trigger on workflow "tests", **When** the "tests" workflow fails, **Then** the automation fires and the agent receives the failure logs as context.
3. **Given** a GitHub event arrives that matches no automation's trigger conditions, **When** the event is routed, **Then** it falls through to the existing default routes (no regression) and no automation session is spuriously created.
4. **Given** multiple automations match the same event, **When** the event arrives, **Then** each matching automation creates its own independent session.

---

### User Story 3 - Slack Message Triggers an Automation (Priority: P2)

A team lead posts a message in a connected Slack channel (e.g., "@agent fix the flaky test in payments") and the platform matches the message against configured automations, spawning an agent session with the Slack message as context.

**Why this priority**: Slack triggers unlock non-technical team members as automation initiators and validate the adapter pattern for non-GitHub event sources.

**Independent Test**: Can be tested by connecting a Slack workspace, configuring an automation with a Slack trigger (channel + keyword match), sending a matching message, and verifying an agent session is created.

**Acceptance Scenarios**:

1. **Given** a Slack workspace is connected and an automation triggers on messages in `#engineering` containing "agent", **When** a user posts "hey @agent fix the login bug", **Then** an agent session is created with the message content as the initial prompt context.
2. **Given** a Slack message arrives in a channel with no matching automations, **When** the event is processed, **Then** it is acknowledged (200 OK to Slack) but no session is created.
3. **Given** the Slack OAuth connection is revoked, **When** the platform attempts to verify a Slack event, **Then** the event is rejected and the automation is flagged as unhealthy.

---

### User Story 4 - Linear Issue Triggers an Automation (Priority: P2)

A developer assigns a Linear issue to the agent (or applies a specific label), and the platform detects the assignment via Linear webhooks and spawns an agent session to implement the issue.

**Why this priority**: Linear integration demonstrates the pattern for project management tool triggers and enables delegating implementation tasks directly from the issue tracker.

**Independent Test**: Can be tested by configuring a Linear trigger automation, assigning an issue to the designated agent user in Linear, and verifying an agent session is created with the issue title and description as context.

**Acceptance Scenarios**:

1. **Given** an automation triggers on Linear issues assigned to "agent-bot", **When** an issue is assigned to "agent-bot", **Then** an agent session is created with the issue title, description, and labels as prompt context.
2. **Given** an automation triggers on issues with label "auto-implement", **When** a developer adds that label to an issue, **Then** the automation fires.
3. **Given** a Linear webhook payload with an unrecognized event type, **When** it is received, **Then** it is safely ignored without errors.

---

### User Story 5 - BugBot Pre-Built Automation (Priority: P3)

A team lead enables BugBot with one click, which creates a pre-configured automation that triggers on every PR opened/updated, runs code review, and posts findings as PR comments. Optionally spawns a follow-up agent to autofix flagged issues.

**Why this priority**: BugBot is a high-value showcase automation that validates the end-to-end system but depends on the automation entity, GitHub triggers, and PR comment posting all working first.

**Independent Test**: Can be tested by enabling BugBot on a repo, opening a PR, and verifying that review comments appear on the PR within a reasonable time window.

**Acceptance Scenarios**:

1. **Given** BugBot is enabled for a repo, **When** a PR is opened, **Then** an agent session runs code review and posts inline comments on the PR highlighting issues.
2. **Given** BugBot finds fixable issues and autofix is enabled, **When** the review completes, **Then** a follow-up agent session is spawned to push a fix commit to the PR branch.
3. **Given** BugBot is disabled by the user, **When** a PR is opened, **Then** no review automation fires.

---

### User Story 6 - Manage Automation Lifecycle (Priority: P3)

A user views all their automations in a list, sees run history and next-run time, can enable/disable/edit/delete automations, and monitors health status.

**Why this priority**: Management UI is essential for production use but is a layer on top of the core engine. The engine must work correctly before the UI can be meaningful.

**Independent Test**: Can be tested by creating several automations via API, then verifying the list view shows correct status, run counts, and that enable/disable toggles take effect.

**Acceptance Scenarios**:

1. **Given** a user has 5 automations, **When** they visit the automations page, **Then** they see all 5 with name, trigger type, status (enabled/paused/error), last run time, and next run time.
2. **Given** an enabled automation, **When** the user clicks "disable", **Then** the automation stops firing and the UI reflects the disabled state immediately.
3. **Given** an automation with 10 past runs, **When** the user views its detail page, **Then** they see the run history with session links, duration, and outcome.

---

### Edge Cases

- What happens when the scheduler is down for an extended period and multiple cron ticks are overdue? (Should batch-fire missed ticks or skip to next future occurrence?)
- How does the system handle a flood of identical events (e.g., 50 pushes in rapid succession)? (Coalescing/deduplication logic)
- What happens when an automation's bound repo is deleted or disconnected?
- How does the system behave when the agent worker queue is full and new automation-triggered jobs are enqueued?
- What happens when Slack/Linear credentials expire mid-operation?
- How are concurrent edits to the same automation handled?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide an automation entity that binds a trigger configuration to a prompt, tool set, model selection, and target repos.
- **FR-002**: System MUST support cron expression triggers with validation (reject malformed expressions on save).
- **FR-003**: System MUST support preset interval triggers (hourly, daily, weekly) as simplified cron presets.
- **FR-004**: System MUST calculate and persist `nextRunAt` for scheduled automations and display it in the UI.
- **FR-005**: System MUST execute due scheduled automations by creating agent sessions through the existing job queue.
- **FR-006**: System MUST support GitHub event triggers (PR opened, pushed, merged, commented, CI completion) by extending the InboundRouter pipeline.
- **FR-007**: System MUST support trigger condition filters (target branch, workflow name, keyword in comment) to scope when automations fire.
- **FR-008**: System MUST support Slack message triggers via Slack Events API integration with OAuth workspace connection.
- **FR-009**: System MUST support Linear issue triggers (assignment, label, status change) via Linear webhook integration.
- **FR-010**: System MUST normalize all trigger sources into the canonical InboundEvent format before routing.
- **FR-011**: System MUST allow multiple automations to match the same event, each creating an independent session.
- **FR-012**: System MUST allow users to enable, disable (pause), edit, and delete automations.
- **FR-013**: System MUST maintain an audit trail of automation runs linking each run back to the triggering event and resulting session.
- **FR-014**: System MUST ship BugBot as a pre-built automation template that triggers on PR events and runs code review.
- **FR-015**: System MUST support coalescing/deduplication for rapid-fire events on the same PR (cancel stale runs before starting new ones).
- **FR-016**: System MUST handle overdue scheduled ticks by skipping to the next future occurrence (no batch-firing of missed ticks).
- **FR-017**: System MUST validate trigger source credentials (Slack tokens, Linear tokens) and surface health status when credentials are invalid or expired.

### Key Entities

- **Automation**: The core entity representing a configured trigger-to-agent binding. Attributes: name, trigger type, trigger configuration, prompt template, tool selection, model, bound repos, enabled/paused state, schedule state (nextRunAt, lastRunAt), owner.
- **Automation Run**: An audit record linking a specific automation execution to the triggering event and the resulting agent session. Attributes: automation ID, trigger event reference, session ID, status, timestamp.
- **Trigger Configuration**: A polymorphic configuration object specific to each trigger type (cron expression for schedules, event type + filter conditions for GitHub, channel + keywords for Slack, assignment/label rules for Linear).
- **Inbound Event (extended)**: The existing canonical event type extended with new sources (slack, linear, scheduler) and kinds (scheduled_tick, slack_message, linear_issue_update).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can create and configure a scheduled automation in under 2 minutes through the UI.
- **SC-002**: Scheduled automations fire within 60 seconds of their configured time.
- **SC-003**: GitHub-triggered automations create agent sessions within 10 seconds of receiving a webhook.
- **SC-004**: The system supports at least 100 active automations per organization without scheduling drift or performance degradation.
- **SC-005**: BugBot posts review comments on a PR within 5 minutes of the PR being opened.
- **SC-006**: 95% of automation runs complete successfully (defined as session created and agent produces output) without user intervention.
- **SC-007**: Users can identify automation health issues (expired credentials, disabled automations, failed runs) within one page view.
- **SC-008**: Adding a new trigger source type requires implementing only an adapter (event normalizer) and trigger condition schema — no changes to the core router or dispatcher.

## Assumptions

- The existing InboundRouter/InboundDispatcher architecture is stable and will be extended (not replaced) for automation dispatch.
- The existing Redis Streams job queue and agent worker infrastructure handles the additional load from automation-triggered sessions.
- GitHub webhook delivery is already configured and functional; Slack and Linear will follow the same inbound webhook pattern on the gateway.
- Cron parsing will use a standard library (no custom implementation); timezone handling uses UTC internally with user-facing display in their configured timezone.
- The automation builder UI will be part of the existing web application (Next.js), not a separate service.
- BugBot configuration follows the existing `.cursor/BUGBOT.md` convention for review rules.
- Authentication and authorization for automation management reuses the existing org/user permission model.
- The scheduler component runs within the existing agent worker process (polling approach) rather than as a separate Render cron service, to minimize infrastructure complexity for v1.

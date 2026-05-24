# Feature Specification: Automations — Schedule Triggers, Event Binding & Builder UI

**Feature Branch**: `sprint-002-automations-foundation`

**Created**: 2026-05-24

**Status**: Draft

**Input**: Sprint 2 requirements batch [R1, R2, R6] from Milestone 2 (Automations). Delivers the automation entity, cron/schedule triggers, GitHub/GitLab event trigger binding via the existing InboundRouter, and an automation builder UI scaffold.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create a Scheduled Automation (Priority: P1)

A platform user opens the Automation Builder, selects "Schedule" as the trigger type, configures a cron expression (e.g., `0 9 * * 1-5` for weekday mornings), writes a prompt ("Check for dependency updates and open a PR if any are outdated"), selects tools and a target repo, and saves the automation. The scheduler picks it up at the next due time and spawns an agent session.

**Why this priority**: The automation entity is the foundational data model that all trigger types depend on. Without a persisted automation configuration, neither cron nor event triggers can function. This story exercises the full stack: entity creation, scheduler polling, and job dispatch.

**Independent Test**: Can be fully tested by creating an automation with a short-interval cron (every minute), waiting 60 seconds, and verifying an agent session was spawned with the correct prompt and tool configuration.

**Acceptance Scenarios**:

1. **Given** a user is on the automations page, **When** they click "New Automation" and select "Schedule" trigger, **Then** a cron expression input and preset dropdown are shown.
2. **Given** a user enters a valid cron expression, **When** they complete the builder flow (prompt + tools + repo), **Then** the automation is persisted and appears in the list with status "Active" and a calculated "Next run at" timestamp.
3. **Given** an active automation has a `nextRunAt` in the past, **When** the scheduler polls, **Then** an agent session is created with the automation's configured prompt, tools, and repo binding.
4. **Given** an automation's scheduled run completes, **When** the session finishes, **Then** `lastRunAt` is updated and `nextRunAt` is recalculated from the cron expression.
5. **Given** a user enters an invalid cron expression (e.g., `* * * * * * *`), **When** they attempt to save, **Then** validation fails with a human-readable error message.

---

### User Story 2 - Trigger Automation from GitHub Events (Priority: P1)

A developer creates an automation with trigger type "GitHub Event" — e.g., trigger on `pr_opened` to the `main` branch. When a matching PR is opened on the bound repository, the system matches it against configured automations and spawns a new agent session with the automation's prompt and tool config.

**Why this priority**: Event-driven dispatch is the most powerful automation pattern and extends existing infrastructure (InboundRouter/InboundDispatcher). The automation entity must bind trigger conditions to prompts/tools, and the dispatcher must be extended with a new action type that creates fresh sessions (not just triggers existing ones).

**Independent Test**: Can be tested by creating an automation bound to `pr_opened` events, simulating a GitHub webhook delivery for a PR opened event, and verifying a new agent session is created.

**Acceptance Scenarios**:

1. **Given** a user creates an automation with trigger `pr_opened` on repo `org/backend`, **When** a PR opened webhook arrives for `org/backend`, **Then** the InboundRouter evaluates the event against configured automations and dispatches a new session.
2. **Given** an automation has a filter condition `base_branch = main`, **When** a PR opened webhook arrives targeting the `develop` branch, **Then** the automation does not fire.
3. **Given** multiple automations match the same event, **When** the webhook arrives, **Then** each matching automation spawns its own independent session.
4. **Given** an automation is paused (enabled = false), **When** a matching event arrives, **Then** no session is created.
5. **Given** a webhook arrives for a repo with no bound automations, **When** the dispatcher evaluates it, **Then** existing InboundRouter behavior is preserved unchanged (backward-compatible).

---

### User Story 3 - List and Manage Automations (Priority: P1)

A platform user navigates to the Automations page to see all configured automations. They see a table with automation name, trigger type, target repo, status (active/paused), last run time, and next run time. They can toggle an automation on/off and delete it.

**Why this priority**: Without a list view and basic management (enable/disable/delete), users cannot observe or control their automations after creation. This is the minimum viable UI for Sprint 2.

**Independent Test**: Can be tested by creating 3 automations (mix of cron and event triggers), navigating to the list page, verifying all appear with correct metadata, toggling one off, and confirming it no longer fires.

**Acceptance Scenarios**:

1. **Given** the user has 5 automations configured, **When** they navigate to `/automations`, **Then** all 5 are displayed in a table with columns: Name, Trigger, Repo, Status, Last Run, Next Run.
2. **Given** an automation is active, **When** the user clicks the enable/disable toggle, **Then** the automation status changes to "paused" and no scheduled/event runs will fire.
3. **Given** a user clicks "Delete" on an automation, **When** they confirm the deletion, **Then** the automation is removed and no future runs will occur.
4. **Given** a scheduled automation has never run, **When** the list displays, **Then** "Last Run" shows "Never" and "Next Run" shows the computed next execution time.

---

### User Story 4 - Automation Detail View with Run History (Priority: P2)

A user clicks into a specific automation to see its full configuration and run history. The detail view shows the trigger configuration, prompt, selected tools, and a chronological list of past runs with their outcomes.

**Why this priority**: Run history provides observability into automation behavior. While the system functions without it, users need visibility to debug and trust automated agent runs.

**Independent Test**: Can be tested by creating an automation, triggering it 3 times, then viewing the detail page and confirming all 3 runs appear with correct status and timestamps.

**Acceptance Scenarios**:

1. **Given** an automation has 10 past runs, **When** the user opens its detail page, **Then** runs are listed chronologically (newest first) with status, duration, and session link.
2. **Given** a run failed, **When** it appears in the history, **Then** the failure reason is shown inline.
3. **Given** the user is on the detail page, **When** they click "Edit", **Then** they are taken to the builder flow pre-populated with the automation's current configuration.

---

### User Story 5 - Preset Schedule Shortcuts (Priority: P3)

For common scheduling patterns, the builder offers preset buttons ("Every hour", "Daily at 9am", "Weekly on Monday") that auto-fill the cron expression, reducing the need to know cron syntax.

**Why this priority**: Improves UX for non-technical users but is not required for core functionality. Power users can always type raw cron expressions.

**Independent Test**: Can be tested by clicking each preset button and verifying the corresponding cron expression is filled in and validated correctly.

**Acceptance Scenarios**:

1. **Given** the user is in the schedule trigger configuration step, **When** they click "Daily at 9am", **Then** the cron input is populated with `0 9 * * *` and validated as correct.
2. **Given** the user selected a preset, **When** they modify the cron expression manually, **Then** no preset appears selected (manual mode).

---

### Edge Cases

- What happens when the scheduler polls and an automation's bound repo has been deleted from the platform? → Log error, skip execution, surface in automation status as "repo_unavailable".
- What happens when two scheduler polls overlap (slow execution)? → Idempotency via `lastRunAt` check: only schedule if current time > nextRunAt AND no run is already in progress for this automation.
- How does the system handle cron expressions that resolve to sub-minute intervals? → Reject at validation: minimum interval is 1 minute.
- What happens when a GitHub webhook arrives but the automation's owner no longer has access to the repo? → Verify repo access at dispatch time; skip and log if access revoked.
- How does timezone handling work for scheduled automations? → Store all times in UTC internally; display in user's timezone in the UI. Cron expressions evaluate in UTC.
- What happens when hundreds of automations are due at the same second (thundering herd)? → Scheduler distributes work via Redis job queue; worker pool handles parallelism naturally.
- What if the same webhook event matches both legacy InboundRouter routes AND new automation rules? → Both fire independently. Legacy routes continue to trigger existing sessions; automation routes create new sessions. No conflict.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist an `automations` entity with: id, name, owner (userId), trigger type, trigger configuration, prompt template, tool configuration, repo binding, enabled status, and scheduling metadata.
- **FR-002**: System MUST support trigger types: `schedule` (cron expression) and `github_event` (event kind + filter conditions). Additional trigger types (slack, linear) are out of scope for this sprint.
- **FR-003**: System MUST validate cron expressions at creation/update time and reject invalid expressions with descriptive error messages.
- **FR-004**: System MUST compute and persist `nextRunAt` for schedule-type automations, recalculating after each run completes.
- **FR-005**: System MUST include a scheduler service that polls for automations where `nextRunAt <= now AND enabled = true`, creating agent sessions for each due automation.
- **FR-006**: System MUST guarantee at-most-once execution per scheduled interval via idempotent dispatch (compare `nextRunAt` atomically during poll).
- **FR-007**: System MUST extend the `InboundRouter` with an `AutomationRoute` that evaluates incoming GitHub/GitLab events against all enabled `github_event` automations for the event's repository.
- **FR-008**: System MUST add a new `RouteAction` type (`create_automation_session`) to the dispatcher that creates a fresh agent session from an automation's configuration rather than triggering an existing session.
- **FR-009**: System MUST preserve full backward compatibility with existing InboundRouter routes — automation dispatch is additive, not a replacement.
- **FR-010**: System MUST support filter conditions on event triggers: base branch, head branch, actor, file paths changed, and PR labels.
- **FR-011**: System MUST expose a REST API for automation CRUD: create, read (list + detail), update, delete, toggle enabled/disabled.
- **FR-012**: System MUST provide a web UI at `/automations` with: list view (table), create flow (multi-step builder), detail view with run history, toggle, and delete.
- **FR-013**: System MUST record each automation execution as a standard agent session with `trigger` field indicating the automation source, and link back to the automation entity.
- **FR-014**: System MUST allow automations to be paused (enabled=false) and resumed (enabled=true) without data loss.
- **FR-015**: System MUST display "Next run at" for schedule automations in the UI, computed from the cron expression relative to current time.

### Key Entities

- **Automation**: A persistent configuration binding a trigger (schedule or event) to an agent execution template (prompt, tools, repos). Owned by a user, scoped to a project/org.
- **AutomationRun**: A join record linking an automation to the agent session it spawned, with metadata (triggered_at, trigger_event_id, outcome).
- **TriggerConfig**: Polymorphic configuration attached to an automation — either `{ type: "schedule", cron: string, timezone?: string }` or `{ type: "github_event", events: string[], filters: FilterCondition[] }`.
- **FilterCondition**: A predicate applied to incoming events before dispatch — field + operator + value (e.g., `base_branch = "main"`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A schedule-type automation fires within 60 seconds of its `nextRunAt` time under normal load.
- **SC-002**: GitHub event automations dispatch a session within 5 seconds of webhook receipt (matching existing InboundRouter latency).
- **SC-003**: The automation list page loads in under 2 seconds with 100 automations (meeting LCP < 2.5s constraint).
- **SC-004**: Zero regressions in existing webhook handling — all current InboundRouter tests continue to pass.
- **SC-005**: Automation CRUD API responds in under 200ms p95 (meeting gateway performance constraint).
- **SC-006**: The scheduler correctly handles clock skew: no duplicate executions and no missed executions under normal operating conditions (single scheduler instance).
- **SC-007**: Users can create a working scheduled automation through the builder UI in under 2 minutes without consulting documentation.

## Clarifications

### Session 2026-05-24

- Q: Should the scheduler be a dedicated Render cron job or a polling worker? → A: Polling worker on a 30-second interval, backed by a Redis-based lock to prevent duplicate scheduling across multiple gateway instances. Simpler than a separate cron service and consistent with existing architecture patterns.
- Q: How does automation dispatch differ from existing InboundDispatcher trigger_session? → A: Existing `trigger_session` triggers an **existing** running session. Automation dispatch creates a **new** session from scratch using the automation's prompt/tools/repo config. New action type `create_automation_session` handles this.
- Q: Should automation runs reuse existing sessions or always create fresh ones? → A: Always fresh sessions. Each automation run is independent and self-contained. This prevents state bleeding between runs.
- Q: How is the automation builder UI structured? → A: Multi-step wizard: (1) Choose trigger type, (2) Configure trigger, (3) Write prompt, (4) Select tools, (5) Choose repos, (6) Review & save. Sprint 2 delivers steps 1-3 and 6 with tools and repos as optional fields (defaulting to all available).
- Q: What existing InboundKind values map to automation event triggers? → A: `pr_opened`, `pr_synchronize`, `pr_merged`, `pr_closed`, `ci_failure`, `ci_success`, `review_comment`. These already exist in the InboundEvent type system.
- Q: Should the automation table reference the `sessions` table or vice versa? → A: Sessions get an optional `automationId` foreign key. Automations do not reference sessions directly — the link is through `automation_runs` join table.

## Assumptions

- The existing Redis infrastructure has sufficient capacity for scheduler polling (one SETNX lock per 30s) without requiring scaling changes.
- The existing InboundRouter first-match-wins semantics will be extended with a final catch-all automation route that runs after all legacy routes — ensuring backward compatibility.
- The gateway API already has auth middleware that will apply to new automation endpoints without additional work.
- The existing agent worker pool has capacity for automation-spawned sessions alongside user-initiated sessions (no dedicated pool needed for Sprint 2).
- Timezone handling for cron expressions defaults to UTC; user-local timezone display is a UI concern only and does not affect scheduling logic.
- The web dashboard's existing layout, design system (Radix + Tailwind), and routing structure accommodate a new `/automations` route without architectural changes.
- Sprint 2 delivers the create/list/detail/toggle/delete UI scaffold. Full CRUD editing of all fields (tools, repos) is completed in Sprint 3.

# Feature Specification: Agent Observability Dashboard

**Feature Branch**: `002-observability-dashboard`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "A basic observability dashboard for the web UI, powered by TanStack Table, showing agent session events, token usage, and cost breakdowns. Currently the app only has a sessions view and settings page."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Session Event Timeline (Priority: P1)

A developer wants to understand what their agents have been doing. They navigate to the observability dashboard and see a unified table of all events across all sessions (LLM calls, tool executions, sandbox runs) with durations, statuses, and metadata. They can filter by session, type, or status to drill down.

**Why this priority**: This is the core debugging use case — the primary reason developers need observability. Without seeing what happened step-by-step, troubleshooting agent behavior is impossible.

**Independent Test**: Can be fully tested by running an agent session, then navigating to the dashboard and verifying the event timeline displays correctly with accurate durations and statuses.

**Acceptance Scenarios**:

1. **Given** multiple completed sessions with events, **When** the user opens the dashboard, **Then** they see a paginated table of all events across sessions sorted newest-first with columns for: user/trigger, session name, event type, status, duration, and timestamp.
2. **Given** an event timeline is displayed, **When** the user clicks on an individual event row, **Then** an inline detail panel expands below the row showing model name, token counts, tool inputs/outputs, error messages, and the triggering user/context.
3. **Given** a session with mixed event types, **When** the user filters by "llm_request" type, **Then** only LLM call events are displayed and the filter state is reflected in the URL.
4. **Given** a session with 500+ events, **When** the user scrolls to the bottom of the current page, **Then** they can load the next page of results via cursor-based pagination.

---

### User Story 2 - Monitor Token Usage and Cost (Priority: P2)

A developer or team lead wants to understand how much their agent sessions are costing. They view an aggregated usage summary showing total tokens consumed, estimated cost, and a breakdown by model or by session over a configurable time range.

**Why this priority**: Cost visibility is critical for budget management and optimizing model selection. Without it, users may unknowingly accumulate significant costs.

**Independent Test**: Can be fully tested by running several sessions with different models, then navigating to the usage view and verifying totals and breakdown match the actual consumption.

**Acceptance Scenarios**:

1. **Given** several sessions have run over the past week, **When** the user opens the usage view, **Then** they see total input tokens, output tokens, and estimated cost for the default 30-day window.
2. **Given** the usage view is displayed, **When** the user switches the "group by" toggle between "model" and "session", **Then** the breakdown table updates to show costs segmented by the selected dimension.
3. **Given** the usage view is displayed, **When** the user changes the date range to "last 7 days", **Then** the totals and breakdown update to reflect only that window.

---

### User Story 3 - Navigate to Observability from Sessions (Priority: P3)

A developer is reviewing a session's chat and wants quick access to its observability data. They click a link or tab within the session view that takes them directly to that session's event timeline, pre-filtered.

**Why this priority**: Reducing friction between "looking at what the agent said" and "looking at how the agent performed" makes observability a natural part of the workflow rather than a separate tool.

**Independent Test**: Can be fully tested by opening a session's chat view, clicking the observability link, and verifying the dashboard opens pre-filtered to that session's events.

**Acceptance Scenarios**:

1. **Given** the user is on a session detail page, **When** they click the "Events" or observability link, **Then** they are navigated to the dashboard with that session's events pre-loaded.
2. **Given** the user arrived at the dashboard via a session link, **When** they clear the session filter, **Then** they can browse events across all their sessions.

---

### User Story 4 - Sort and Filter Event Data (Priority: P3)

A developer debugging a specific issue wants to quickly find relevant events. They use column sorting, status filters, and type filters to narrow down the event list.

**Why this priority**: Large event volumes make raw chronological lists impractical. Filtering and sorting are essential for efficient debugging.

**Independent Test**: Can be fully tested by applying various filter/sort combinations and verifying the table correctly responds.

**Acceptance Scenarios**:

1. **Given** an event table is displayed, **When** the user clicks the "Duration" column header, **Then** events are sorted by duration (ascending/descending toggle).
2. **Given** an event table is displayed, **When** the user selects "error" from the status filter, **Then** only failed events are shown.
3. **Given** multiple filters are applied, **When** the user clicks "Clear filters", **Then** all filters are removed and the full event list is restored.

---

### Edge Cases

- What happens when a session has zero events? — Display an empty state with helpful messaging.
- What happens when events are still being recorded (session in progress)? — Show a "live" indicator and allow manual refresh or auto-poll.
- What happens when the user has no sessions at all? — Display a prompt to start their first session.
- How does the dashboard handle very long metadata values (e.g., large tool outputs)? — Truncate in the table view; show full content in the expanded detail.
- What if the date range returns no usage data? — Show zero-state with the selected range acknowledged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a dedicated observability page accessible via its own icon in the icon rail (peer to the Sessions icon), routing to a top-level `/observability` path.
- **FR-002**: System MUST display a paginated, sortable table of agent events across all sessions by default, with a session column and the ability to filter to a specific session.
- **FR-003**: System MUST support filtering events by type (llm_request, tool_call, sandbox_exec, error, system) and status (running, success, error, timeout, interrupted).
- **FR-004**: System MUST allow users to expand an event row inline (below the row within the table) to view full metadata including model, token counts, tool name, duration breakdown, and error details.
- **FR-014**: System MUST display clear attribution for each event showing which user or trigger (e.g., manual message, webhook, CI event, review job) caused the agent to execute.
- **FR-005**: System MUST provide a usage summary view showing total input tokens, output tokens, and estimated cost for a configurable date range.
- **FR-006**: System MUST allow grouping usage data by model or by session.
- **FR-007**: System MUST support date range selection for the usage view with sensible presets (last 7 days, last 30 days, custom range).
- **FR-008**: System MUST provide deep-linking from a session detail page to its event timeline.
- **FR-009**: System MUST persist filter and sort state in URL query parameters so views are shareable and bookmarkable.
- **FR-010**: System MUST only display events and usage for sessions the authenticated user owns (or all sessions for admins).
- **FR-011**: System MUST handle loading, empty, and error states gracefully with appropriate feedback.
- **FR-012**: System MUST support cursor-based pagination matching the existing events API contract (limit, cursor params).
- **FR-013**: System MUST render responsively on both desktop and mobile viewports.

### Key Entities

- **Event**: A discrete observability record within a session — has type, status, duration, timestamps, and flexible metadata (tokens, model, tool name, error info).
- **Usage Aggregate**: A computed summary of token consumption and estimated cost, grouped by model or session, over a date range.
- **Session**: The parent container for events — referenced by ID with associated metadata (repo, branch, title, status).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can identify the slowest event in a session within 10 seconds of opening the dashboard (sort by duration).
- **SC-002**: Users can determine total token spend for the past 30 days within 5 seconds of opening the usage view.
- **SC-003**: Event table renders 100 rows with sorting and filtering in under 1 second on a standard connection.
- **SC-004**: Dashboard is fully functional with zero additional infrastructure — no external services required beyond the existing Postgres database.
- **SC-005**: Navigation from session chat to session events requires a single click.
- **SC-006**: All table interactions (sort, filter, paginate) complete without full page reloads.
- **SC-007**: Dashboard works on viewports from 375px (mobile) to 2560px (ultrawide) without horizontal scrolling of the primary layout.

## Clarifications

### Session 2026-05-21

- Q: Where should the observability dashboard live in the app navigation? → A: New dedicated icon in the icon rail, as a peer to Sessions.
- Q: What should the default landing view show? → A: All events across all sessions in one table (filterable by session), since per-session detail is already visible in the session thread.
- Q: How should event metadata be presented? → A: Inline expandable rows (click to expand detail below the row). Table must also show clear signal on what user or trigger caused the agent to execute.

## Assumptions

- The existing observability data layer (agent_events table, event_series, API endpoints) is deployed and recording events.
- TanStack Table (`@tanstack/react-table` ^8.21.3) is already installed in the web app and will be the table rendering engine.
- The dashboard will follow existing app conventions: custom primitives + Tailwind semantic tokens, icon rail navigation, SWR for client data fetching.
- The dashboard is read-only in v1 — no actions (delete events, export CSV) are in scope.
- Authentication and authorization reuse the existing NextAuth session and API `requireAuth` patterns.
- The dashboard does not need real-time streaming of events in v1 — manual refresh or SWR revalidation is sufficient.
- Date/time display uses the browser's locale (no server-side timezone handling needed).

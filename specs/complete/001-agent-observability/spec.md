# Feature Specification: Agent Observability

**Feature Branch**: `001-agent-observability`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "Agent observability module with OTel-compatible event capture, time-series storage in Postgres (normalized schema with JSONB metadata, time-partitioned, configurable retention), and optional OTel Collector export. V1 focuses on the data layer — agent-side observability for tool calls, LLM interactions, and sandbox executions. Dashboard deferred to follow-up."

## Clarifications

### Session 2026-05-21

- Q: Who can access event data? → A: Session owner + admins only (matches existing session permissions).
- Q: How is event volume controlled for runaway sessions? → A: Hard cap of 10,000 events per session (configurable via env var), warning emitted at 80% threshold.
- Q: Should events stream in real-time or be query-only in v1? → A: Query-only in v1; events are immediately queryable after capture. Real-time SSE streaming deferred to dashboard follow-up.
- Q: Should v1 include cross-session token/cost aggregation? → A: Yes, include aggregation endpoint (sum by time range, group by session or model).
- Q: How should sensitive data in event metadata be handled? → A: Auto-redact known secret patterns (*_KEY, *_SECRET, *_TOKEN) and truncate large values to configurable maximum before storage.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View Agent Session Trace (Priority: P1)

A developer runs an agent session and afterward wants to understand what happened: which tools were called, how long each step took, whether any failed, and how many tokens were consumed. They query the observability data layer (via API) to get a structured timeline of the session's execution.

**Why this priority**: This is the core pain point — developers today have no visibility into what an agent did during a session. Without structured event capture, debugging agent behavior requires reading raw logs.

**Independent Test**: Can be fully tested by running an agent session, then querying the events API to retrieve a complete, ordered trace of all events with durations, statuses, and metadata.

**Acceptance Scenarios**:

1. **Given** an agent session completes, **When** a developer queries events for that session, **Then** they receive a chronologically ordered list of all tool calls, LLM requests, and sandbox executions with start/end times, durations, and status.
2. **Given** an agent session has a failed tool call, **When** a developer queries events for that session, **Then** the failed event includes error context (error message, relevant IDs) alongside successful events.
3. **Given** an agent session used multiple LLM calls, **When** a developer queries token usage for that session, **Then** they see per-call token counts (input/output) and a session total.
4. **Given** a developer is not the session owner and is not an admin, **When** they attempt to query events for that session, **Then** the request is rejected with a 403 response.

---

### User Story 2 - Automatic Event Capture During Agent Execution (Priority: P1)

The agent worker automatically emits structured observability events as it executes — without requiring changes to existing tool implementations. Event capture is transparent: tool calls, LLM requests, and sandbox executions are instrumented at the orchestration layer.

**Why this priority**: If event capture requires manual instrumentation of every tool, adoption will be incomplete and fragile. Automatic capture at the orchestration boundary ensures comprehensive coverage.

**Independent Test**: Can be tested by running an agent session with existing tools and verifying that events appear in the database without any tool-level code changes.

**Acceptance Scenarios**:

1. **Given** the agent worker processes a job, **When** it calls any tool, **Then** a tool_call event is automatically recorded with tool name, arguments summary (redacted of secrets), result status, and duration.
2. **Given** the agent worker makes an LLM API call, **When** the call completes, **Then** an llm_request event is recorded with model name, token counts (input/output), latency, and whether it was streamed.
3. **Given** the agent worker executes a sandbox command, **When** the command finishes, **Then** a sandbox_exec event is recorded with command type, exit code, duration, and output size.
4. **Given** a tool argument contains a value matching a known secret pattern (e.g., `ANTHROPIC_API_KEY=sk-...`), **When** the event is recorded, **Then** the secret value is redacted in stored metadata.

---

### User Story 3 - Token Usage and Cost Aggregation (Priority: P2)

A developer or platform operator wants to understand total token consumption and estimated cost across multiple sessions — for example, "how many tokens did this project consume this week?" or "which model is costing the most?". They query an aggregation endpoint that summarizes usage by time range, session, or model.

**Why this priority**: Understanding spend is a top pain point for agent developers managing API costs. The per-event data exists from User Story 1, but without an aggregation layer, developers must write raw SQL or export data to get cross-session insights.

**Independent Test**: Can be tested by running multiple agent sessions with different models, then querying the aggregation endpoint to verify correct totals grouped by time period and model.

**Acceptance Scenarios**:

1. **Given** multiple sessions have completed over the past week, **When** a developer queries token aggregation for that time range, **Then** they receive total input/output tokens and estimated cost, grouped by model.
2. **Given** a developer queries aggregation for a specific session, **When** the response returns, **Then** it includes per-event-type breakdown (LLM tokens, tool call count, sandbox execution count).
3. **Given** no sessions exist in the queried time range, **When** the aggregation endpoint is called, **Then** it returns zero values (not an error).

---

### User Story 4 - Configurable Data Retention (Priority: P2)

A platform operator configures how long observability data is retained. Old data is automatically purged without manual intervention or performance degradation of the main application database.

**Why this priority**: Without retention management, the events table grows unbounded and eventually degrades both write and query performance. Operators need control over the cost/history tradeoff.

**Independent Test**: Can be tested by setting a short retention period, inserting old events, and verifying they are removed by the retention process without affecting recent data.

**Acceptance Scenarios**:

1. **Given** the retention period is configured to 30 days, **When** the retention job runs, **Then** all events older than 30 days are removed and storage is reclaimed.
2. **Given** no explicit retention configuration is set, **When** the system operates, **Then** it defaults to 30 days retention.
3. **Given** the retention period is changed from 30 to 7 days, **When** the next retention job runs, **Then** events older than 7 days are removed.

---

### User Story 5 - Export Events to External OTel Collector (Priority: P3)

A developer who already operates an observability stack (Jaeger, Grafana Tempo, Datadog, etc.) configures an OTel Collector endpoint. Agent events are exported as OTel-compatible spans in addition to being stored locally.

**Why this priority**: Power users and organizations with existing observability infrastructure want to integrate agent traces into their unified view. This makes the platform non-opinionated about observability tooling.

**Independent Test**: Can be tested by configuring an OTel endpoint (e.g., a local Jaeger instance), running an agent session, and verifying spans appear in the external collector with correct parent/child relationships.

**Acceptance Scenarios**:

1. **Given** `OTEL_EXPORTER_OTLP_ENDPOINT` is configured, **When** agent events are captured, **Then** they are also exported as OTel spans to the configured endpoint.
2. **Given** no OTel endpoint is configured, **When** agent events are captured, **Then** they are stored locally only with no export errors or warnings.
3. **Given** the OTel endpoint is unreachable, **When** agent events are captured, **Then** local storage continues unaffected and export failures are logged without blocking agent execution.

---

### Edge Cases

- What happens when the database is under heavy write load from concurrent agent sessions? Events MUST be buffered and written asynchronously to avoid blocking agent execution.
- What happens when an agent session is interrupted mid-execution (kill signal, OOM)? Incomplete events MUST have a "timeout" or "interrupted" status rather than remaining open indefinitely.
- What happens when event metadata exceeds a reasonable size (e.g., a tool returns a very large output)? Metadata MUST be truncated to a configurable maximum size with an indication that truncation occurred.
- What happens during database migrations when the events table schema changes? Existing data MUST remain queryable; migrations MUST be additive (new columns, not removed ones).
- What happens when a session hits the 10,000 event cap? A final warning event is recorded indicating the cap was reached, and further events for that session are silently dropped. The session itself continues executing normally.
- What happens when event metadata contains values matching known secret patterns? Secrets MUST be redacted before storage — the original value is never persisted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST automatically capture structured events for every tool call, LLM request, and sandbox execution during agent sessions.
- **FR-002**: Each event MUST include: session ID, event type, start timestamp, end timestamp, duration, status (success/error/timeout), and type-specific metadata.
- **FR-003**: Events MUST support hierarchical relationships (parent/child) to represent nested operations (e.g., a tool call that triggers a sandbox execution).
- **FR-004**: System MUST store events in the existing Postgres database using a normalized schema with series identity separated from measurements.
- **FR-005**: Event metadata MUST be stored as flexible structured data (not fixed columns) to support new event types without schema migrations.
- **FR-006**: System MUST partition event data by time to enable efficient retention and query pruning.
- **FR-007**: System MUST provide configurable retention with a default of 30 days, enforced via automated cleanup.
- **FR-008**: System MUST expose a query API for retrieving events by session, time range, event type, and status.
- **FR-009**: System MUST optionally export events as OTel-compatible spans when an export endpoint is configured via environment variable.
- **FR-010**: Event capture MUST NOT block or slow down agent execution — writes MUST be asynchronous or buffered.
- **FR-011**: System MUST record token usage (input and output counts) for every LLM interaction.
- **FR-012**: System MUST handle partial failures gracefully — if event storage fails, agent execution continues unaffected.
- **FR-013**: Event data access MUST follow existing session permissions — only the session owner and platform admins can query events for a given session.
- **FR-014**: System MUST enforce a configurable per-session event cap (default: 10,000). A warning event MUST be emitted at 80% of the cap. Events beyond the cap are silently dropped.
- **FR-015**: System MUST auto-redact values matching known secret patterns (`*_KEY`, `*_SECRET`, `*_TOKEN`) in event metadata before storage.
- **FR-016**: System MUST truncate event metadata values exceeding a configurable maximum size, with a flag indicating truncation occurred.
- **FR-017**: System MUST expose an aggregation endpoint for token usage and cost, queryable by time range with grouping by session and/or model.

### Key Entities

- **Event**: A discrete unit of work performed by the agent. Has a type (tool_call, llm_request, sandbox_exec, error), timestamps, duration, status, and metadata. Belongs to a session. May have a parent event.
- **Series Identity**: The stable combination of attributes that identifies a class of events (session + event type). Stored once and referenced by compact ID to reduce per-row storage cost.
- **Session** (existing): The existing session entity gains a relationship to its events for observability queries.
- **Retention Policy**: Configuration defining how long events are kept before automated purging.
- **Usage Aggregate**: A computed view of token consumption and estimated cost, derived from llm_request events, queryable by time range, session, and model.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After an agent session completes, a developer can retrieve the full event trace within 2 seconds.
- **SC-002**: Event capture adds less than 50ms of overhead per agent session (total, not per-event).
- **SC-003**: The system handles 100 concurrent agent sessions generating events without write contention or dropped events.
- **SC-004**: Retention cleanup removes expired data within 5 minutes of the scheduled run without impacting live query performance.
- **SC-005**: Developers can identify the root cause of a failed agent session by examining its event trace without needing to read raw application logs, in 80% of failure cases.
- **SC-006**: Storage growth is predictable: at steady-state with retention enabled, the events table size stabilizes rather than growing unbounded.
- **SC-007**: Token aggregation queries return results within 3 seconds for time ranges up to 30 days.
- **SC-008**: No secret values (API keys, tokens, passwords) are present in stored event metadata after redaction.

## Assumptions

- The existing Postgres 16 database has capacity for the additional write load from agent events (estimated: tens of thousands of events per day for a typical deployment).
- Agent sessions are the primary unit of work; events are always scoped to a session.
- The agent worker (Bun) has direct database access via the shared `packages/db` layer.
- Event metadata varies by type but always fits within reasonable JSONB size limits (< 10KB per event after truncation).
- The OTel export feature uses the standard OTLP/gRPC or OTLP/HTTP protocol, compatible with any OTel Collector.
- A follow-up feature will add a visual dashboard in the web UI and real-time event streaming via SSE; this spec covers the data layer and query API only.
- Downsampling (aggregating older data to coarser resolution) is deferred to a future iteration if storage becomes a concern at scale.
- Cost estimation uses configurable per-model token pricing (not real-time billing API calls).
- The event cap (10,000 per session) is generous for legitimate sessions; typical sessions generate hundreds of events.

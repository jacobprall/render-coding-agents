# Data Model: Agent Observability Dashboard

**Date**: 2026-05-21 | **Branch**: `002-observability-dashboard`

## Entities

### AgentEvent (existing — no schema changes)

| Field | Type | Notes |
|-------|------|-------|
| id | text (PK) | ULID for sortability |
| runId | text (nullable) | FK → agent_runs.id |
| sessionId | text | FK → sessions.id (cascade delete) |
| seriesId | integer | FK → event_series.id |
| parentEventId | text (nullable) | Self-reference for nested spans |
| eventType | enum | `llm_request`, `tool_call`, `sandbox_exec`, `error`, `system` |
| status | enum | `running`, `success`, `error`, `timeout`, `interrupted` |
| startedAt | timestamp | Event start |
| endedAt | timestamp (nullable) | Event end (null if still running) |
| durationMs | integer (nullable) | Computed: endedAt - startedAt |
| metadata | jsonb | Flexible: tokens, model, cost, tool I/O, error info |
| createdAt | timestamp | Row insertion time |

**Indexes used by dashboard queries**:
- `agent_events_session_created_idx` (sessionId, createdAt) — per-session filtering
- `agent_events_status_idx` (status) — status filter
- New index needed: `agent_events_created_idx` (createdAt DESC, id DESC) — cross-session pagination

### Session (existing — read-only for display)

| Field | Type | Dashboard usage |
|-------|------|----------------|
| id | text (PK) | Event grouping key |
| userId | text | Ownership/access control |
| title | text (nullable) | Display in session column |
| repoPath | text (nullable) | Context for session identification |
| status | enum | Active/completed indicator |
| createdAt | timestamp | Session age display |

### User (existing — read-only for attribution)

| Field | Type | Dashboard usage |
|-------|------|----------------|
| id | text (PK) | Join key from sessions |
| name | text (nullable) | Display in trigger/user column |
| email | text | Fallback display |
| image | text (nullable) | Avatar in attribution |

### AgentRun (existing — read-only for trigger context)

| Field | Type | Dashboard usage |
|-------|------|----------------|
| id | text (PK) | Event's runId reference |
| trigger | text (nullable) | "message", "webhook", "ci", "review" |

## Relationships

```
User 1──N Session 1──N AgentEvent
                    └──N AgentRun 1──N AgentEvent (via runId)
```

## New Index Required

```sql
CREATE INDEX CONCURRENTLY agent_events_created_desc_idx
  ON agent_events (created_at DESC, id DESC);
```

This supports the cross-session query's `ORDER BY created_at DESC, id DESC` without a sequential scan when no session filter is applied.

## Derived/Computed Data

### Usage Aggregate (computed at query time — no materialization)

| Field | Source |
|-------|--------|
| inputTokens | SUM(metadata->'tokens'->>'input') for type='llm_request' |
| outputTokens | SUM(metadata->'tokens'->>'output') for type='llm_request' |
| estimatedCost | SUM(metadata->>'estimatedCostUsd') for type='llm_request' |
| llmRequestCount | COUNT(*) for type='llm_request' |
| key | model name or session id (from groupBy) |

### Trigger Attribution (computed at join time)

| Display | Source |
|---------|--------|
| User name/email | sessions.userId → users.name/email |
| Trigger type | agent_runs.trigger (nullable, fallback: "manual") |

## State Transitions

Events themselves have status transitions (`running` → `success`/`error`/`timeout`/`interrupted`) but these are managed by the agent recorder, not the dashboard. The dashboard is strictly read-only.

## Data Volume Assumptions

- 10,000 events per session max (enforced by OBSERVABILITY_EVENT_CAP)
- Retention: 30 days default (managed by retention job)
- Typical user: 5–50 sessions with 50–5,000 events each
- Admin view: potentially all users' sessions

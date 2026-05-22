# API Contracts: Observability Dashboard

## New Endpoint: Cross-Session Events

### `GET /api/observability/events`

Query agent events across all sessions accessible to the authenticated user.

**Authentication**: `requireAuth()` — session-based (web) or API key (gateway)

**Query Parameters**:

| Param | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `limit` | integer (1–200) | No | 100 | Page size |
| `cursor` | string | No | — | Event ID for cursor pagination (fetch events before this ID) |
| `sessionId` | string | No | — | Filter to a specific session |
| `type` | enum | No | — | Filter by event type |
| `status` | enum | No | — | Filter by event status |
| `after` | ISO 8601 datetime | No | — | Events after this timestamp |
| `before` | ISO 8601 datetime | No | — | Events before this timestamp |

**Enums**:
- `type`: `llm_request`, `tool_call`, `sandbox_exec`, `error`, `system`
- `status`: `running`, `success`, `error`, `timeout`, `interrupted`

**Success Response** (`200 OK`):

```json
{
  "items": [
    {
      "id": "1716300000000_abc123defg",
      "runId": "run_xyz",
      "sessionId": "sess_abc",
      "sessionTitle": "Fix failing tests",
      "sessionRepoPath": "owner/repo",
      "userName": "Jane Developer",
      "userEmail": "jane@example.com",
      "trigger": "message",
      "parentEventId": null,
      "eventType": "llm_request",
      "status": "success",
      "startedAt": "2026-05-21T10:30:00.000Z",
      "endedAt": "2026-05-21T10:30:02.500Z",
      "durationMs": 2500,
      "metadata": {
        "model": "claude-sonnet-4-20250514",
        "tokens": { "input": 1500, "output": 800 },
        "estimatedCostUsd": 0.0165
      },
      "createdAt": "2026-05-21T10:30:02.500Z"
    }
  ],
  "nextCursor": "1716300000000_abc123defg"
}
```

**Error Responses**:
- `400`: Invalid query parameters (Zod validation error)
- `401`: Not authenticated
- `500`: Internal server error

**Access Control**:
- Non-admin users: Only events from sessions where `sessions.userId = auth.userId`
- Admin users: All events across all sessions

---

## Existing Endpoint: Usage Aggregation (unchanged)

### `GET /api/observability/usage`

No changes to this endpoint. Dashboard consumes it as-is.

---

## Existing Endpoint: Per-Session Events (unchanged)

### `GET /api/sessions/[id]/events`

No changes. Used for deep-link pre-filtered views (redirects to `/api/observability/events?sessionId=X` pattern in the UI).

---

## Gateway Mirrors

All new endpoints are mirrored in the Hono gateway under the same path structure for headless/MCP consumption:

- `GET /api/observability/events` → same contract as web route

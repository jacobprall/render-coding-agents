# API Contracts: Parallel Agents Infrastructure

**Date**: 2026-05-22 | **Feature**: 007-parallel-agents-infra

## Overview

This feature extends existing API surfaces rather than creating new services. The contracts below cover new endpoints and modifications to existing ones.

---

## 1. Sandbox Service API (Internal)

**Base URL**: `http://{SANDBOX_SERVICE_HOST}:3001`  
**Auth**: Bearer `SANDBOX_SHARED_SECRET` + `X-Session-Id` header

### Existing Endpoints (behavior changes)

#### `POST /mirror/ensure`

Ensures a bare clone mirror exists. **Change**: Now also validates mirror health before returning success.

```typescript
// Request
{
  workspaceId: string;
  repoUrl: string;       // https://github.com/owner/repo.git (with token)
  repoPath: string;      // 'owner/repo'
}

// Response 200
{
  status: 'ready' | 'created';
  mirrorPath: string;    // '/workspace/mirrors/{workspaceId}/{owner}/{repo}.git'
  healthy: boolean;      // NEW: result of health validation
}

// Response 500 (corruption detected)
{
  status: 'corrupted';
  error: string;
  recovering: boolean;   // true if background re-clone started
}
```

#### `POST /mirror/fetch`

Fetches latest commits into an existing mirror. **New behavior**: Called by agent before worktree creation (fetch-on-start).

```typescript
// Request
{
  workspaceId: string;
  repoPath: string;
  repoUrl?: string;      // Optional: if provided, used for auth token refresh
}

// Response 200
{
  status: 'fetched' | 'up_to_date';
  newCommits: number;
  durationMs: number;
}

// Response 404 (mirror doesn't exist)
{
  error: 'mirror_not_found';
}
```

### New Endpoints

#### `POST /mirror/validate`

Health check for a specific mirror. Used by 24h cron and pre-worktree validation.

```typescript
// Request
{
  workspaceId: string;
  repoPath: string;
}

// Response 200
{
  healthy: boolean;
  mirrorPath: string;
  sizeBytes: number;
  lastFetchedAt: string; // ISO timestamp
}

// Response 200 (unhealthy)
{
  healthy: false;
  error: string;         // e.g., 'fsck_failed', 'missing_objects'
  mirrorPath: string;
}
```

#### `POST /mirror/recover`

Delete corrupted mirror and start background re-clone.

```typescript
// Request
{
  workspaceId: string;
  repoPath: string;
  repoUrl: string;
}

// Response 202
{
  status: 'recovery_started';
  estimatedDurationMs: number;
}
```

#### `GET /mirror/status`

List all mirrors with their health status. Used by 24h cron and monitoring.

```typescript
// Response 200
{
  mirrors: Array<{
    workspaceId: string;
    repoPath: string;
    status: 'ready' | 'syncing' | 'corrupted' | 'pending';
    lastFetchedAt: string | null;
    lastSessionUsedAt: string | null;
    sizeBytes: number;
  }>;
  totalDiskUsageBytes: number;
  diskCapacityBytes: number;
}
```

---

## 2. Web App API (External)

**Base URL**: `/api`  
**Auth**: NextAuth.js session (cookie) or API key

### New Endpoints

#### `POST /api/sessions/{id}/steer`

Send a steering message to an active agent session.

```typescript
// Request
{
  content: string;       // User's mid-flight message
  action?: 'message' | 'interrupt';  // Default: 'message'
}

// Response 200
{
  delivered: boolean;
  eventId: string;       // Redis stream ID
}

// Response 409 (no active run)
{
  error: 'no_active_run';
  sessionStatus: string;
}
```

**Implementation**: Publishes `user:message` or `user:interrupt` event to `run:{activeRunId}` channel. Agent picks it up between iterations.

#### `POST /api/sessions/{id}/approve-plan`

Approve a generated plan, transitioning the run from planning to execution.

```typescript
// Request
{
  approved: boolean;
  feedback?: string;     // If rejected, optional guidance
}

// Response 200 (approved)
{
  status: 'execution_started';
  runId: string;
}

// Response 200 (rejected)
{
  status: 'plan_rejected';
  runId: string;
}

// Response 409 (not in planning state)
{
  error: 'not_awaiting_approval';
  currentPhase: string;
  runStatus: string;
}
```

**Implementation**: Sets `user:plan_approved` or `user:plan_rejected` event. Agent resumes from paused state.

#### `POST /api/webhooks/github/push`

GitHub webhook endpoint for push events. Triggers mirror fetch.

```typescript
// Request: GitHub push event payload
// Headers: X-Hub-Signature-256, X-GitHub-Event

// Response 200
{
  processed: boolean;
  mirrorsUpdated: string[];  // repo paths that were fetched
}

// Response 400 (signature invalid)
{
  error: 'invalid_signature';
}
```

**Implementation**: Verify HMAC signature, find matching `webhook_subscriptions`, trigger `/mirror/fetch` on sandbox for each matched repo.

### Modified Endpoints

#### `GET /api/sessions/{id}/stream` (SSE)

**Change**: Now emits the full event taxonomy. Backward compatibility maintained via `normalizeEvent()`.

New event types in the stream:
- `planner:message` — planning phase LLM output
- `planner:context` — files being analyzed during planning
- `plan:generated` — plan ready for approval
- `step:started` / `step:completed` — workspace setup progress
- `user:message` (echo) — confirms steering message received

Existing event types unchanged: `agent:message`, `agent:tool_call`, `agent:tool_result`, `session:completed`, `session:failed`.

---

## 3. Gateway API (External / MCP)

**Base URL**: `http://{GATEWAY_HOST}:5555`  
**Auth**: API key (Bearer)

### New Endpoints (mirror web API)

#### `POST /v1/sessions/{id}/steer`

Same contract as web API steering endpoint. Enables CLI and MCP clients to steer sessions.

#### `POST /v1/sessions/{id}/approve`

Same contract as web API plan approval endpoint.

#### `GET /v1/sessions/{id}/events`

SSE stream — same as web API stream endpoint. Already partially exists; extend with full taxonomy.

---

## 4. Agent Job Payload Contract

The job payload sent via Redis Streams to the agent worker. Extended fields marked.

```typescript
interface AgentJob {
  // Existing
  runId: string;
  chatId: string;
  sessionId: string;
  userId: string;
  messages: Message[];
  modelMessages: ModelMessage[];
  modelId: string;
  
  // Workspace fields (exist in schema, ensure populated)
  workspaceId: string;               // projects.id
  repos: Array<{
    repoPath: string;                // 'owner/repo'
    branch: string;
    isPrimary: boolean;
    forgeType: string;
  }>;
  resolvedEnv: Record<string, string>;      // Tier 1: env vars (visible to LLM)
  resolvedSecrets: Record<string, string>;  // Tier 2: runtime (stripped from LLM)
  
  // Extended
  activeSkillRefs: SkillRef[];       // From workspace defaults + session overrides
  projectConfig: Record<string, unknown>;  // Merged workspace config
  instructions: string | null;       // Workspace instructions
  phase: SessionPhase;               // 'planning' | 'execution'
  planningMode?: boolean;            // If true, use read-only tool set
}
```

---

## 5. Event Bus Contract (Internal)

### Publishing (agent → Redis)

```typescript
interface EventBus {
  publish(runId: string, event: StreamEventV2): Promise<string>;  // Returns stream ID
  setStatus(runId: string, status: RunStatus): Promise<void>;
  getStatus(runId: string): Promise<RunStatus | null>;
}
```

### Subscribing (SSE endpoints)

```typescript
interface EventSubscriber {
  replay(runId: string, afterId?: string): AsyncIterable<EventEnvelope>;
  subscribe(runId: string, callback: (event: EventEnvelope) => void): () => void;
}
```

### Steering (web → agent via Redis)

```typescript
interface SteeringChannel {
  sendSteering(runId: string, event: SteeringEvent): Promise<string>;
  onSteering(runId: string, callback: (event: SteeringEvent) => void): () => void;
}
```

Implementation: Same Redis Pub/Sub channel (`run:{runId}`). Steering events are distinguished by `type` prefix (`user:`).

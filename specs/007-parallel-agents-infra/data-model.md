# Data Model: Parallel Agents Infrastructure

**Date**: 2026-05-22 | **Feature**: 007-parallel-agents-infra

## Entity Overview

```
Org
 └── Project (= Workspace)
       ├── projectRepos[]           # Multi-repo associations
       ├── environmentConfig        # Tier 1: visible to LLM
       ├── secretsConfig            # Tiers 2+3: runtime + build
       ├── computeDefaults          # Concurrency, timeout settings
       ├── defaultSkills[]          # Inherited by sessions
       ├── repoMirrorStatus        # Per-repo mirror health
       └── Sessions[]
             ├── Chats[]
             │    ├── ChatMessages[]
             │    └── AgentRuns[]
             └── worktrees (ephemeral, disk-only)
```

## Existing Schema (already in place)

### `projects` table (Workspace role)

| Column | Type | Status | Purpose |
|--------|------|--------|---------|
| `id` | text PK | Exists | UUID |
| `orgId` | text FK → orgs | Exists | Ownership |
| `name` | text | Exists | Display name |
| `slug` | text | Exists | URL-safe identifier |
| `config` | jsonb | Exists | Auto-merge, default model, verify checks |
| `instructions` | text | Exists | Natural-language rules inherited by sessions |
| `isScratch` | boolean | Exists | Default workspace (no repo) |
| `environmentConfig` | jsonb | Exists | `Record<string, string>` — Tier 1 env vars |
| `secretsConfig` | jsonb | Exists | `{ env: {}, runtime: {}, build: {} }` — Tiers 1-3 |
| `computeDefaults` | jsonb | Exists | Concurrency, timeouts |
| `defaultSkills` | jsonb | Exists | `SkillRef[]` — inherited by sessions |
| `repoMirrorStatus` | jsonb | Exists | Per-repo sync status |
| `lastMirrorSyncedAt` | timestamp | Exists | Last successful sync across all repos |
| `createdBy` | text FK → users | Exists | |
| `createdAt` / `updatedAt` | timestamp | Exists | |

### `projectRepos` table

| Column | Type | Purpose |
|--------|------|---------|
| `id` | text PK | UUID |
| `projectId` | text FK → projects | Workspace association |
| `repoPath` | text | `owner/repo` format |
| `forgeType` | text | `github` (extensible) |
| `isPrimary` | boolean | Primary repo for single-repo compat |
| `branch` | text | Default branch |
| `config` | jsonb | Per-repo overrides |

### `sessions` table (relevant fields)

| Column | Type | Purpose |
|--------|------|---------|
| `projectId` | text FK → projects (nullable) | Workspace association |
| `repoPath` | text | Legacy single-repo path |
| `branch` | text | Session branch |
| `projectConfig` | jsonb | Resolved workspace config (snapshot at creation) |
| `activeSkills` | jsonb | Resolved from workspace defaults |
| `status` | enum | `running|completed|failed|archived|deleted` |

### `agentRuns` table (relevant fields)

| Column | Type | Purpose |
|--------|------|---------|
| `phase` | SessionPhase enum | `planning|execution|...` |
| `status` | enum | `queued|running|paused|completed|aborted|failed|error` |
| `trigger` | enum | What initiated the run |

## Schema Extensions Needed

### 1. `mirrors` table (formalize mirror tracking)

A dedicated table to track per-repo mirror state (currently tracked loosely in `repoMirrorStatus` jsonb). This provides queryable state for the 24h cron and health monitoring.

```sql
CREATE TABLE mirrors (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_path TEXT NOT NULL,              -- 'owner/repo'
  forge_type TEXT NOT NULL DEFAULT 'github',
  disk_path TEXT NOT NULL,              -- '/workspace/mirrors/{projectId}/{owner}/{repo}.git'
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'syncing' | 'ready' | 'corrupted' | 'deleted'
  last_fetched_at TIMESTAMPTZ,
  last_session_used_at TIMESTAMPTZ,     -- For idle detection (24h cron)
  size_bytes BIGINT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX mirrors_project_repo_idx ON mirrors(project_id, repo_path);
CREATE INDEX mirrors_status_idx ON mirrors(status);
CREATE INDEX mirrors_idle_idx ON mirrors(last_session_used_at) WHERE status = 'ready';
```

### 2. `webhook_subscriptions` table (track GitHub webhook registrations)

```sql
CREATE TABLE webhook_subscriptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_path TEXT NOT NULL,
  forge_type TEXT NOT NULL DEFAULT 'github',
  webhook_id TEXT,                       -- GitHub webhook ID
  webhook_secret TEXT,                   -- HMAC secret for verification
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'active' | 'failed'
  last_delivery_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX webhook_subs_project_repo_idx ON webhook_subscriptions(project_id, repo_path);
```

### 3. Extend `SessionPhase` enum

```typescript
export enum SessionPhase {
  PLANNING = 'planning',
  EXECUTION = 'execution',
  REVIEW = 'review',        // existing
  CI_FIX = 'ci_fix',        // existing
}
```

### 4. Extend `AgentRunStatus` 

The `paused` status already exists in the schema. Used for planning-awaiting-approval state.

## Event Schema (Redis Streams)

### Stream key pattern

```
run:{runId}:events    — durable event log (XADD, MAXLEN ~2000)
run:{runId}           — pub/sub channel for real-time fan-out
```

### Event type taxonomy

```typescript
// Planning phase
type PlanningEvents =
  | { type: 'planner:message';    payload: { content: string } }
  | { type: 'planner:context';    payload: { files: string[]; reasoning?: string } }
  | { type: 'plan:generated';     payload: { steps: PlanStep[]; summary: string } }
  | { type: 'user:plan_approved'; payload: {} }
  | { type: 'user:plan_rejected'; payload: { feedback?: string } }

// Execution phase (existing, formalized)
type ExecutionEvents =
  | { type: 'step:started';       payload: { stepId: string; stepType: string } }
  | { type: 'step:completed';     payload: { stepId: string; durationMs: number } }
  | { type: 'step:failed';        payload: { stepId: string; error: string } }
  | { type: 'agent:message';      payload: { content: string } }
  | { type: 'agent:tool_call';    payload: { tool: string; args: Record<string, unknown> } }
  | { type: 'agent:tool_result';  payload: { tool: string; result: unknown; durationMs: number } }
  | { type: 'agent:heartbeat';    payload: { activity: string } }

// Steering
type SteeringEvents =
  | { type: 'user:message';       payload: { content: string; messageId: string } }
  | { type: 'user:interrupt';     payload: { action: 'cancel' | 'pause' } }

// Lifecycle
type LifecycleEvents =
  | { type: 'session:completed';  payload: { prUrl?: string; summary?: string } }
  | { type: 'session:failed';     payload: { error: string; phase: SessionPhase } }
  | { type: 'session:cancelled';  payload: { reason: string } }
```

### Event envelope

```typescript
interface EventEnvelope {
  id: string;         // Redis stream ID (auto-assigned)
  type: string;       // Namespaced event type
  payload: unknown;   // Type-specific payload
  ts: number;         // Unix timestamp ms
  runId: string;      // Owning agent run
  sessionId: string;  // Parent session
}
```

## Secrets Model

### Three-tier structure (on `projects.secretsConfig`)

```typescript
interface SecretsConfig {
  env: Record<string, string>;      // Tier 1: visible to LLM context + terminal
  runtime: Record<string, string>;  // Tier 2: terminal only, redacted from LLM
  build: Record<string, string>;    // Tier 3: Docker builds only
}
```

### Enforcement points

| Tier | Agent system prompt | Terminal env | Docker build | LLM context |
|------|--------------------:|-------------:|-------------:|------------:|
| `env` | Injected | Injected | Injected | Visible |
| `runtime` | NOT injected | Injected (prefixed `__SECRET__`) | Injected | Stripped by tool layer |
| `build` | NOT injected | NOT injected | BuildKit secret mount | NOT visible |

### Resolution flow

```
Session created → startAgentJob()
  → resolveSecrets(project.secretsConfig)
  → job.resolvedEnv = { ...project.environmentConfig, ...secrets.env }
  → job.resolvedSecrets = secrets.runtime  (stored separately, stripped from LLM)
  → build secrets: stored encrypted, passed to sandbox at build time only
```

## Mirror Lifecycle State Machine

```
                   ┌──────────┐
        create     │ pending  │
        ───────────▶          │
                   └────┬─────┘
                        │ git clone --bare
                        ▼
                   ┌──────────┐
                   │ syncing  │◀──── webhook push / fetch-on-start / 24h cron
                   └────┬─────┘
                        │ success
                        ▼
                   ┌──────────┐
    session start  │  ready   │◀──── normal state
    ───────────────▶          │
                   └────┬─────┘
                        │ validation fails (git fsck)
                        ▼
                   ┌──────────┐
                   │corrupted │
                   └────┬─────┘
                        │ delete + re-clone
                        ▼
                   ┌──────────┐
                   │ pending  │  (cycle restarts)
                   └──────────┘
```

## Workspace Inheritance Resolution Order

When a session starts, config is resolved in this priority (highest wins):

1. **Session-level overrides** (user provides per-session config)
2. **Project/Workspace defaults** (`projects.config`, `environmentConfig`, `secretsConfig`, `defaultSkills`, `instructions`)
3. **Org-level defaults** (future, not in this milestone)

Resolved config is snapshotted into the job payload at enqueue time. The agent worker does not query the database for workspace config — the job is self-contained.

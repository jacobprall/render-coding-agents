# Data Model: Workspace Model, Repo Mirrors & Event Taxonomy

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Schema Changes

All changes are additive to existing tables. No columns are removed or renamed.

### 1. `projects` table extensions (workspace promotion)

The existing `projects` table is promoted to a workspace role. New columns are added for workspace-level configuration.

```sql
ALTER TABLE projects ADD COLUMN environment_config JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN secrets_config JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN compute_defaults JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN default_skills JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN repo_mirror_status JSONB DEFAULT '{}';
ALTER TABLE projects ADD COLUMN last_mirror_synced_at TIMESTAMPTZ;
```

#### Field definitions

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `environment_config` | `JSONB` | `{}` | Key-value pairs of env vars inherited by all sessions. `{ "NODE_ENV": "development", "API_BASE": "https://..." }` |
| `secrets_config` | `JSONB` | `{}` | Encrypted three-tier secrets. `{ "env": {...}, "runtime": {...}, "build": {...} }` — each tier is a key-value map. Values encrypted at rest via `ENCRYPTION_KEY`. |
| `compute_defaults` | `JSONB` | `{}` | Default compute config for sessions. `{ "model": "anthropic/claude-sonnet-4-5", "maxSteps": 100, "timeout": 1800 }` |
| `default_skills` | `JSONB` | `[]` | Default skills array inherited by sessions. `[{ "source": "builtin", "slug": "speckit" }]` — same shape as `sessions.activeSkills`. |
| `repo_mirror_status` | `JSONB` | `{}` | Per-repo mirror state. `{ "org/repo": { "status": "ready", "lastFetchedAt": "...", "sizeBytes": 123456 } }` |
| `last_mirror_synced_at` | `TIMESTAMPTZ` | `null` | Timestamp of the most recent successful mirror sync across all repos in this workspace. |

#### `secrets_config` structure

```typescript
interface SecretsConfig {
  env: Record<string, string>;      // Tier 1: visible to agent in LLM context
  runtime: Record<string, string>;  // Tier 2: redacted from LLM, available in terminal
  build: Record<string, string>;    // Tier 3: Docker build only, never at runtime
}
```

#### `repo_mirror_status` structure

```typescript
interface RepoMirrorStatus {
  [repoPath: string]: {
    status: "initializing" | "ready" | "syncing" | "stale" | "error";
    lastFetchedAt: string | null;    // ISO 8601
    sizeBytes: number;
    errorMessage?: string;
    diskPath?: string;               // e.g. "/workspace/mirrors/{workspaceId}/org/repo.git"
  };
}
```

### 2. `sessions` table extensions (additive overrides + multi-repo)

```sql
ALTER TABLE sessions ADD COLUMN session_env_overrides JSONB DEFAULT '{}';
ALTER TABLE sessions ADD COLUMN session_skills_overrides JSONB DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN repos_used JSONB DEFAULT '[]';
ALTER TABLE sessions ADD COLUMN summary JSONB;
```

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `session_env_overrides` | `JSONB` | `{}` | Additive env var overrides for this session only. Merged on top of workspace `environment_config`. Cannot shadow workspace keys. |
| `session_skills_overrides` | `JSONB` | `[]` | Additional skills for this session only. Merged with workspace `default_skills`. |
| `repos_used` | `JSONB` | `[]` | List of repos this session operated on. `["org/frontend", "org/backend"]`. Populated during session, used in summary. |
| `summary` | `JSONB` | `null` | Permanent session summary written on completion. `{ "outcome": "completed", "durationMs": 45000, "reposTouched": [...], "prUrls": [...], "linesAdded": 42, "linesRemoved": 10 }` |

#### `summary` structure (FR-021)

```typescript
interface SessionSummary {
  outcome: "completed" | "failed" | "aborted";
  durationMs: number;
  reposTouched: string[];
  prUrls: string[];
  linesAdded: number;
  linesRemoved: number;
  toolCallCount: number;
  llmCostUsd: number;
  completedAt: string; // ISO 8601
}
```

### 3. `project_repos` table — no changes needed

The existing `project_repos` join table already supports multi-repo via `projectId` + `repoPath`. The `isPrimary` flag designates the main repo. No schema changes required.

### 4. New: `mirror_sync_log` table (operational observability)

```sql
CREATE TABLE mirror_sync_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  repo_path TEXT NOT NULL,
  trigger TEXT NOT NULL,       -- 'webhook' | 'cron' | 'session_init' | 'manual'
  status TEXT NOT NULL,        -- 'success' | 'failed'
  duration_ms INTEGER NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX mirror_sync_log_project_idx ON mirror_sync_log(project_id);
CREATE INDEX mirror_sync_log_created_idx ON mirror_sync_log(created_at);
```

Purpose: Audit trail for mirror sync operations. Enables debugging stale mirror issues and monitoring webhook reliability.

## Event Taxonomy (Redis Streams)

### Current event structure

Events are stored in Redis Streams at key `run:{runId}:events` with field `e` containing a JSON-serialized `StreamEvent`.

### New event structure

The `StreamEvent` interface is replaced with a namespaced, versioned structure:

```typescript
interface StreamEventV2 {
  v: 2;
  type: string;          // namespaced: "agent:message", "step:started", etc.
  ts: string;            // ISO 8601 timestamp
  payload: Record<string, unknown>;
}
```

### Event type mapping (old → new)

| Old type | New type | Payload changes |
|----------|----------|-----------------|
| `token` | `agent:message` | `{ token, content }` |
| `tool_call` | `agent:tool_call` | `{ tool, toolCallId, args }` |
| `tool_result` | `agent:tool_result` | `{ tool, toolCallId, result }` |
| `heartbeat` | `agent:heartbeat` | `{ activity, step, timestamp }` |
| `file_changed` | `agent:file_changed` | `{ path, additions, deletions }` |
| `done` | `session:completed` | `{ prUrl, summary }` |
| `error` | `session:failed` | `{ message, code, retryable }` |
| `aborted` | `session:aborted` | `{ reason }` |
| `ask_user` | `agent:ask_user` | `{ question, options }` |
| `task_start` | `step:started` | `{ stepId, stepType, task }` |
| `task_done` | `step:completed` | `{ stepId, durationMs }` |
| `task_error` | `step:failed` | `{ stepId, error }` |
| `spec` | `plan:generated` | `{ spec }` |
| `step_persisted` | `agent:step_persisted` | `{ partCount }` |
| *(new)* | `user:message` | `{ content }` |
| *(new)* | `user:interrupt` | `{ action }` |
| *(new)* | `planner:message` | `{ content }` |
| *(new)* | `planner:context` | `{ files }` |
| *(new)* | `user:plan_approved` | `{}` |
| *(new)* | `step:degraded` | `{ stepId, reason, fallback }` |

### Migration strategy

Events include a `v` field. Consumers check `v` and handle both formats:

```typescript
function normalizeEvent(raw: StreamEvent | StreamEventV2): StreamEventV2 {
  if ('v' in raw && raw.v === 2) return raw;
  return migrateV1ToV2(raw);
}
```

The SSE endpoints (`apps/web`, `apps/gateway`) call `normalizeEvent()` before sending to clients. Old producers are migrated incrementally.

### Event retention

- Redis Streams: 7-day TTL via periodic trim job (runs hourly, removes entries older than 7 days)
- Session summary: persisted to `sessions.summary` JSONB column permanently on session completion (FR-021)

## Entity Relationship Diagram

```
┌─────────┐
│  orgs   │
└────┬────┘
     │ 1:N
     ▼
┌──────────────────────┐     1:N    ┌───────────────────┐
│  projects (workspace)│────────────│  project_repos    │
│                      │            │  (multi-repo)     │
│  + environment_config│            └───────────────────┘
│  + secrets_config    │
│  + compute_defaults  │
│  + default_skills    │
│  + repo_mirror_status│
└──────────┬───────────┘
           │ 1:N
           ▼
┌──────────────────────┐     1:N    ┌───────────────────┐
│  sessions            │────────────│  chats            │
│                      │            └────────┬──────────┘
│  + session_env_overrides│                  │ 1:N
│  + session_skills_overrides│               ▼
│  + repos_used        │            ┌───────────────────┐
│  + summary           │            │  agent_runs       │
└──────────┬───────────┘            └───────────────────┘
           │ 1:N
           ▼
┌──────────────────────┐
│  mirror_sync_log     │
│  (operational audit) │
└──────────────────────┘
```

## Disk Layout (Sandbox)

```
/workspace/
├── mirrors/                              # NEW: bare clone storage
│   └── {workspaceId}/
│       └── {org}/
│           └── {repo}.git/               # bare clone, webhook-synced
├── {sessionId}/                          # EXISTING: per-session workspace
│   ├── repos/                            # NEW: multi-repo layout
│   │   ├── {repo1}/                      # worktree from bare clone
│   │   └── {repo2}/                      # worktree from bare clone
│   └── .agent/                           # NEW: merged agent config
│       ├── config.json
│       └── rules/
└── snapshots/                            # EXISTING: unchanged
    └── {snapshotId}.tar.gz
```

## Authorization Model

| Action | Required role |
|--------|-------------|
| Create/delete workspace | Org admin |
| Configure workspace (env vars, secrets, skills, repos) | Org admin |
| Launch session against workspace | Any org member |
| Add session-level env vars / skills (additive only) | Any org member |
| View workspace config | Any org member |

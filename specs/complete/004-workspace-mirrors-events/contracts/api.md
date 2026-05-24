# API Contracts: Workspace Model, Repo Mirrors & Event Taxonomy

**Spec**: [spec.md](../spec.md) | **Data Model**: [data-model.md](../data-model.md)

All endpoints follow the existing gateway pattern: Hono routes, Zod validation, bearer token auth (`X-Api-Key` or OAuth). Base path: `/api/v1`.

---

## 1. Workspace Configuration

### GET /api/v1/projects/:projectId/workspace

Returns workspace-level configuration for a project.

**Auth**: Any org member

**Response** `200`:
```json
{
  "id": "proj_abc123",
  "name": "My Workspace",
  "environmentConfig": { "NODE_ENV": "development" },
  "secretsConfig": {
    "env": { "API_KEY": "sk-..." },
    "runtime": ["DB_PASSWORD"],
    "build": ["DOCKER_TOKEN"]
  },
  "computeDefaults": { "model": "anthropic/claude-sonnet-4-5", "maxSteps": 100 },
  "defaultSkills": [{ "source": "builtin", "slug": "speckit" }],
  "repoMirrorStatus": {
    "org/frontend": { "status": "ready", "lastFetchedAt": "2026-05-21T10:00:00Z", "sizeBytes": 52428800 },
    "org/backend": { "status": "syncing", "lastFetchedAt": "2026-05-21T09:00:00Z", "sizeBytes": 104857600 }
  },
  "repos": [
    { "repoPath": "org/frontend", "isPrimary": true, "defaultBranch": "main" },
    { "repoPath": "org/backend", "isPrimary": false, "defaultBranch": "main" }
  ]
}
```

Note: `secretsConfig.runtime` and `secretsConfig.build` return key names only (values are never exposed via API). `secretsConfig.env` returns full values since they're visible to the agent anyway.

### PUT /api/v1/projects/:projectId/workspace

Updates workspace-level configuration. Partial update — only provided fields are changed.

**Auth**: Org admin only (FR-008)

**Request**:
```json
{
  "environmentConfig": { "NODE_ENV": "production", "API_BASE": "https://api.example.com" },
  "secretsConfig": {
    "env": { "API_KEY": "sk-newkey" },
    "runtime": { "DB_PASSWORD": "secret123" },
    "build": { "DOCKER_TOKEN": "dkr_..." }
  },
  "computeDefaults": { "model": "anthropic/claude-sonnet-4-5" },
  "defaultSkills": [{ "source": "builtin", "slug": "speckit" }]
}
```

**Response** `200`: Updated workspace config (same shape as GET).

**Response** `403`: `{ "error": "Only org admins can configure workspaces" }`

### Validation (Zod schemas)

```typescript
const WorkspaceConfigSchema = z.object({
  environmentConfig: z.record(z.string()).optional(),
  secretsConfig: z.object({
    env: z.record(z.string()).optional(),
    runtime: z.record(z.string()).optional(),
    build: z.record(z.string()).optional(),
  }).optional(),
  computeDefaults: z.object({
    model: z.string().optional(),
    maxSteps: z.number().int().positive().optional(),
    timeout: z.number().int().positive().optional(),
  }).optional(),
  defaultSkills: z.array(z.object({
    source: z.enum(["builtin", "user", "repo"]),
    slug: z.string(),
  })).optional(),
});
```

---

## 2. Mirror Management

### POST /api/v1/projects/:projectId/mirrors/sync

Triggers a manual sync of all repo mirrors for a workspace.

**Auth**: Org admin

**Response** `202`:
```json
{
  "message": "Mirror sync initiated",
  "repos": ["org/frontend", "org/backend"]
}
```

### GET /api/v1/projects/:projectId/mirrors

Returns mirror status for all workspace repos.

**Auth**: Any org member

**Response** `200`:
```json
{
  "mirrors": {
    "org/frontend": {
      "status": "ready",
      "lastFetchedAt": "2026-05-21T10:00:00Z",
      "sizeBytes": 52428800
    },
    "org/backend": {
      "status": "error",
      "lastFetchedAt": "2026-05-21T09:00:00Z",
      "sizeBytes": 0,
      "errorMessage": "Authentication failed"
    }
  },
  "totalSizeBytes": 52428800,
  "diskUsagePercent": 12.5
}
```

---

## 3. Session Creation (extended)

### POST /api/v1/sessions (modified)

Existing endpoint. Extended to support workspace-aware sessions and additive overrides.

**New request fields** (all optional, additive to existing schema):

```json
{
  "repoPath": "org/frontend",
  "projectId": "proj_abc123",
  "sessionEnvOverrides": { "DEBUG": "true" },
  "sessionSkillsOverrides": [{ "source": "user", "slug": "my-custom-skill" }]
}
```

When `projectId` is provided:
- Session inherits workspace `environmentConfig`, `secretsConfig`, `computeDefaults`, `defaultSkills`
- `sessionEnvOverrides` are merged additively (cannot shadow workspace keys)
- `sessionSkillsOverrides` are appended to workspace `defaultSkills`
- All workspace repos are set up as worktrees in the session workspace

**Validation**: `sessionEnvOverrides` keys must not overlap with workspace `environmentConfig` keys. Returns `400` if overlap detected.

---

## 4. Sandbox Endpoints (internal, new)

These are internal endpoints on the sandbox service (port 3001), authenticated via `SANDBOX_SHARED_SECRET`. Not exposed to end users.

### POST /mirror/ensure

Ensures a bare clone mirror exists for a repo. Creates if missing, fetches if exists.

**Request**:
```json
{
  "workspaceId": "proj_abc123",
  "repoPath": "org/frontend",
  "cloneUrl": "https://x-access-token:ghs_xxx@github.com/org/frontend.git"
}
```

**Response** `200`:
```json
{
  "status": "ready",
  "path": "/workspace/mirrors/proj_abc123/org/frontend.git",
  "sizeBytes": 52428800,
  "created": false
}
```

### POST /mirror/fetch

Fetches latest changes for an existing mirror (webhook-triggered).

**Request**:
```json
{
  "workspaceId": "proj_abc123",
  "repoPath": "org/frontend"
}
```

**Response** `200`:
```json
{
  "status": "success",
  "durationMs": 1200,
  "newCommits": 3
}
```

### POST /worktree/create

Creates a git worktree from a bare clone mirror for a session.

**Request**:
```json
{
  "workspaceId": "proj_abc123",
  "sessionId": "ses_xyz789",
  "repoPath": "org/frontend",
  "branchName": "agent/ses_xyz789",
  "baseBranch": "main"
}
```

**Response** `200`:
```json
{
  "path": "/workspace/ses_xyz789/repos/frontend",
  "branch": "agent/ses_xyz789",
  "durationMs": 120
}
```

### POST /worktree/remove

Removes a git worktree when a session ends.

**Request**:
```json
{
  "sessionId": "ses_xyz789",
  "repoPath": "org/frontend"
}
```

**Response** `200`: `{ "removed": true }`

### GET /disk/status

Returns disk usage statistics for mirror management.

**Response** `200`:
```json
{
  "totalBytes": 21474836480,
  "usedBytes": 5368709120,
  "mirrorBytes": 2147483648,
  "usagePercent": 25.0,
  "mirrorCount": 12,
  "worktreeCount": 3
}
```

---

## 5. Webhook Endpoint (extended)

### POST /api/v1/webhooks/github (modified)

Existing endpoint. Extended to handle push events for mirror sync.

**New behavior**: When a `push` event arrives for a repo that has a mirror:
1. Look up all workspaces with this repo in `project_repos`
2. For each workspace, trigger `POST /mirror/fetch` on the sandbox
3. Update `repo_mirror_status` and `last_mirror_synced_at` in the workspace

---

## 6. Event Stream (modified)

### GET /api/v1/sessions/:id/stream (modified)

Existing SSE endpoint. Extended to normalize events to V2 format.

**New SSE event format**:
```
data: {"v":2,"type":"agent:tool_call","ts":"2026-05-21T10:00:00.123Z","payload":{"tool":"edit_file","toolCallId":"tc_1","args":{"path":"src/index.ts"}}}
```

During migration, the endpoint calls `normalizeEvent()` to translate V1 events to V2 format transparently.

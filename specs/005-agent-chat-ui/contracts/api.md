# API Contracts: Agent Chat UI

## New Endpoints

### GET /api/sessions/[id]/files

Returns directory contents for the file tree (lazy-loaded per directory).

**Query Parameters**:
- `path` (string, default: `/`) — directory path relative to repo root

**Response** (200):
```json
{
  "path": "/",
  "entries": [
    { "name": "src", "path": "/src", "type": "directory" },
    { "name": "package.json", "path": "/package.json", "type": "file", "extension": "json", "size": 1024 },
    { "name": "README.md", "path": "/README.md", "type": "file", "extension": "md", "size": 2048, "gitStatus": "modified" }
  ]
}
```

**Error** (404): Session not found or no repo attached
```json
{ "error": "Session has no repository" }
```

---

### GET /api/sessions/[id]/files/content

Returns file content for preview.

**Query Parameters**:
- `path` (string, required) — file path relative to repo root

**Response** (200):
```json
{
  "path": "/src/app.ts",
  "content": "import ...",
  "language": "typescript",
  "size": 4096,
  "truncated": false
}
```

**Constraints**:
- Files > 500KB return `truncated: true` with first 500KB of content
- Binary files return `{ "binary": true, "content": null }`

---

### GET /api/sessions/[id]/git/status

Returns current git working tree status.

**Response** (200):
```json
{
  "branch": "feat/add-auth",
  "ahead": 2,
  "behind": 0,
  "changes": [
    { "path": "src/auth.ts", "status": "modified", "linesAdded": 15, "linesRemoved": 3 },
    { "path": "src/login.tsx", "status": "added", "linesAdded": 45, "linesRemoved": 0 }
  ],
  "clean": false
}
```

**Response when clean** (200):
```json
{
  "branch": "main",
  "ahead": 0,
  "behind": 0,
  "changes": [],
  "clean": true
}
```

---

### POST /api/sessions/[id]/git/commit

Creates a branch (optionally) and commits current changes.

**Request body**:
```json
{
  "message": "Add authentication flow",
  "branch": "feat/add-auth",
  "createBranch": true
}
```

**Response** (200):
```json
{
  "commitSha": "abc123f",
  "branch": "feat/add-auth",
  "filesChanged": 3,
  "linesAdded": 60,
  "linesRemoved": 3
}
```

**Error** (409): Conflicts or uncommittable state
```json
{ "error": "Merge conflicts detected", "conflictFiles": ["src/app.ts"] }
```

---

### GET /api/sessions (modified)

Existing endpoint, extended with grouping support.

**Query Parameters** (new):
- `filter` (string, default: `active`) — `active`, `archived`, `all`
- `grouped` (boolean, default: `false`) — if true, response is grouped by repoPath

**Response when grouped** (200):
```json
{
  "groups": [
    {
      "repoPath": "user/my-app",
      "sessions": [
        { "id": "...", "title": "Add auth", "status": "completed", "lastActivityAt": "..." }
      ]
    },
    {
      "repoPath": null,
      "label": "Scratch",
      "sessions": [...]
    }
  ]
}
```

---

## Modified Endpoints

### Server Actions (existing pattern)

```typescript
// New actions following existing archiveSessionAction pattern:

async function renameSessionAction(sessionId: string, title: string): Promise<{ error?: string }>
// Validates: title.length > 0 && title.length <= 100
// Updates: sessions.title WHERE id = sessionId AND user_id = currentUser

async function deleteSessionAction(sessionId: string): Promise<{ error?: string }>
// Soft-delete: sets sessions.status = 'deleted'
// Validates: session belongs to current user
// NOT reversible from UI (admin-only recovery)
```

---

## SSE Stream Events (existing, documented)

The existing `/api/sessions/[id]/stream` SSE endpoint already emits:

```
event: token
data: {"content": "Hello"}

event: tool_call
data: {"name": "write_file", "args": {"path": "src/app.ts"}, "status": "running"}

event: tool_result
data: {"toolCallId": "...", "result": "File written"}

event: file_change
data: {"path": "src/app.ts", "action": "modified"}

event: done
data: {"runId": "...", "durationMs": 4500}
```

The `file_change` event is used by the file tree to invalidate and refetch affected directory nodes.

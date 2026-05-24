# API Contracts: Right Panel File Operations

## Existing Endpoints (to be connected to sandbox)

### GET `/api/sessions/[id]/files`

List directory contents for the session's workspace.

**Query Parameters:**
- `path` (string, default: "/") — directory path relative to workspace root

**Response (200):**
```json
{
  "path": "/src",
  "entries": [
    {
      "name": "index.ts",
      "path": "/src/index.ts",
      "type": "file",
      "extension": "ts",
      "size": 1234,
      "gitStatus": "modified"
    },
    {
      "name": "components",
      "path": "/src/components",
      "type": "directory"
    }
  ]
}
```

**Errors:**
- 401: Unauthorized (auth failed)
- 403: Forbidden (not session owner)
- 404: Session has no repository / directory not found
- 500: Sandbox communication failure

---

### GET `/api/sessions/[id]/files/content`

Retrieve file content from the session workspace.

**Query Parameters:**
- `path` (string, required) — file path relative to workspace root

**Response (200):**
```json
{
  "path": "/src/index.ts",
  "content": "import { app } from './app';\n...",
  "language": "typescript",
  "size": 1234,
  "truncated": false
}
```

**Notes:**
- Files > 500KB are truncated; `truncated: true` is set
- Binary files return `{ "error": "Binary file", "binary": true }` with status 422

**Errors:**
- 400: Missing `path` parameter
- 401/403: Auth errors
- 404: File not found
- 422: Binary file (cannot display)
- 500: Sandbox communication failure

---

### GET `/api/sessions/[id]/git/status`

Get git status for the session workspace.

**Response (200):**
```json
{
  "branch": "main",
  "ahead": 2,
  "behind": 0,
  "changes": [
    {
      "path": "src/index.ts",
      "status": "modified",
      "linesAdded": 15,
      "linesRemoved": 3
    }
  ],
  "clean": false
}
```

**Errors:**
- 401/403: Auth errors
- 404: Session has no repository
- 500: Sandbox communication failure

---

## New Endpoint

### GET `/api/sessions/[id]/git/diff`

Get unified diff for a specific file in the session workspace.

**Query Parameters:**
- `path` (string, required) — file path relative to workspace root

**Response (200):**
```json
{
  "path": "src/index.ts",
  "diff": "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,5 +1,7 @@\n import { app } from './app';\n+import { logger } from './logger';\n ...",
  "binary": false,
  "tooLarge": false
}
```

**Notes:**
- Diff is standard unified format (parseable by existing `diff-viewer.tsx`)
- Files with > 1000 changed lines return `tooLarge: true` with a truncated diff
- Binary files return `binary: true` with empty diff string

**Errors:**
- 400: Missing `path` parameter
- 401/403: Auth errors
- 404: File not found or no changes for this file
- 500: Sandbox communication failure

---

### POST `/api/sessions/[id]/git/commit` (existing)

Commit current changes in the session workspace.

**Request Body:**
```json
{
  "message": "feat: add logging support"
}
```

**Response (200):**
```json
{
  "hash": "abc1234",
  "message": "feat: add logging support",
  "filesChanged": 3
}
```

---

## Sandbox Internal API (called from Next.js API routes)

These endpoints are on the sandbox container's HTTP server (not publicly exposed).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/files?path=<dir>` | List directory entries |
| GET | `/files/content?path=<file>` | Read file content |
| GET | `/git/status` | Git status summary |
| GET | `/git/diff?path=<file>` | Unified diff for one file |
| POST | `/git/commit` | Commit with message |

All sandbox endpoints return JSON. Errors use standard HTTP status codes.

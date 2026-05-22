# Research: Right Panel File Operations

## Decision 1: Sandbox Communication Pattern

**Decision**: HTTP client wrapper (`sandbox-client.ts`) calling the session's sandbox container endpoint.

**Rationale**: The existing architecture uses Docker containers with a Bun HTTP server as sandboxes. Each session has a `repoPath` and a sandbox URL. The API routes already have the auth + session lookup pattern; we just need a thin HTTP client that forwards requests to the sandbox's file/git endpoints.

**Alternatives considered**:
- Direct filesystem access from Next.js → Rejected: sandbox isolation boundary must be respected (Constitution VI)
- WebSocket connection to sandbox → Rejected: overkill for request/response file operations; HTTP aligns with existing pattern

## Decision 2: Right Panel Max-Width Removal Strategy

**Decision**: Replace the `RIGHT_PANEL_MAX` constant (600) with a dynamic calculation: `window.innerWidth - sidebarSpace - CHAT_MIN_WIDTH - handleSpace`. Pass this computed max to `usePanelResize`.

**Rationale**: The spec requires no hard cap. The existing `enforceViewportConstraints()` function in `app-shell.tsx` already handles the case where panels overflow viewport — it closes the right panel. We just need to let the resize hook's `maxSize` be dynamic rather than static.

**Alternatives considered**:
- Remove maxSize entirely from usePanelResize → Rejected: still need a ceiling to prevent panel overlapping chat area
- CSS-only approach (flex with min-width on chat) → Rejected: resize handle needs explicit pixel values for drag behavior

## Decision 3: Icon-Rail Pattern for File Selection

**Decision**: When a file is selected in files mode, the tree view collapses to a ~40px vertical icon rail (showing expand chevrons for folders and file icons). The preview takes the remaining panel width. A breadcrumb bar at top shows the file path and a "back to tree" button.

**Rationale**: Per clarification session — maximizes reading space while keeping navigation accessible. The breadcrumb already exists in `file-preview.tsx` with a back button. We just need to add the narrow rail as an intermediate state between "full tree" and "no tree".

**Alternatives considered**:
- 50/50 persistent split → Rejected: wastes space in narrow panels
- Tree hides entirely → Rejected: loses spatial context; user can't quickly switch files

## Decision 4: Git Panel Inline Diff Expansion

**Decision**: Each file in the git changes list becomes expandable. Clicking a file fetches its unified diff from a new `/api/sessions/[id]/git/diff?path=<file>` endpoint and renders it inline using the existing `SingleFileDiffViewer` component.

**Rationale**: The `diff-viewer.tsx` component already parses and renders unified diffs with proper line numbers, green/red highlighting, and hunk headers. The git panel currently only shows file status + line counts. Adding a disclosure/expand pattern per file and fetching the diff on demand keeps initial load fast.

**Alternatives considered**:
- Fetch all diffs upfront with git status → Rejected: expensive for repos with many changed files
- Navigate to a separate diff view page → Rejected: breaks the panel-based workflow; spec says inline

## Decision 5: Sandbox API Contract

**Decision**: The sandbox HTTP server exposes these endpoints (called from Next.js API routes):
- `GET /files?path=<dir>` → `{ entries: FileEntry[] }`
- `GET /files/content?path=<file>` → `{ content: string, size: number }`
- `GET /git/status` → `{ branch, changes[], clean }`
- `GET /git/diff?path=<file>` → `{ diff: string }` (unified diff text)
- `POST /git/commit` → `{ hash, message }`

**Rationale**: Matches the existing API route stubs. The sandbox already runs a Bun HTTP server for command execution; these are additional route handlers.

**Alternatives considered**:
- Exec git/ls commands directly via sandbox exec endpoint → Rejected: more complex parsing; dedicated endpoints are cleaner and cacheable
- GraphQL on sandbox → Rejected: Constitution I (simplicity); REST is sufficient

## Decision 6: SSE File Change Notification

**Decision**: Reuse the existing SSE stream that delivers agent response events. When the sandbox detects file changes (via `fs.watch` or post-command hook), it emits a `file_changed` event with `{ path, type: "created" | "modified" | "deleted" }`. The `use-file-tree` hook already has `notifyFileTreeChange()` wired to listener pattern — just need to call it from the SSE handler.

**Rationale**: The infrastructure exists. The hook already invalidates the parent directory on notification. No new transport needed.

**Alternatives considered**:
- Polling directory on interval → Rejected: Constitution IX (performance); wasteful and delayed
- Separate WebSocket for file events → Rejected: SSE already established; one fewer connection

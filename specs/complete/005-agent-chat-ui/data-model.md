# Data Model: Agent Chat UI

## Existing Entities (no schema changes required)

The UI overhaul is primarily a frontend restructuring. The existing database schema already supports all required data. No new tables or columns are needed.

### sessions (existing)

| Field | Type | Notes |
|-------|------|-------|
| id | text PK | Session identifier |
| user_id | text FK → users | Owner (privacy scoping) |
| title | text | Conversation title (renameable) |
| status | text | `running`, `completed`, `failed`, `archived`, `idle`, `paused` |
| repo_path | text | Repository path (used for sidebar grouping) |
| branch | text | Git branch name |
| last_activity_at | timestamp | Sort key for sidebar ordering |
| created_at | timestamp | Creation time |
| updated_at | timestamp | Last modification |

**Lifecycle states** (spec clarification: active, archived, deleted):
- `active` = any status except `archived`
- `archived` = status column set to `'archived'`
- `deleted` = status column set to `'deleted'` (soft-delete, excluded from all queries)

### chat_messages (existing)

| Field | Type | Notes |
|-------|------|-------|
| id | text PK | Message identifier |
| chat_id | text FK → chats | Parent chat |
| role | text | `user` or `assistant` |
| parts | jsonb | Structured message parts (text, tool calls, ask_user) |
| run_id | text FK → agent_runs | Links message to a specific agent run |
| created_at | timestamp | Timestamp |

### agent_runs (existing)

| Field | Type | Notes |
|-------|------|-------|
| id | text PK | Run identifier |
| session_id | text FK → sessions | Parent session |
| status | text | `running`, `completed`, `failed` |
| started_at | timestamp | Run start |
| finished_at | timestamp | Run end |
| total_duration_ms | integer | Elapsed time (for "Worked for X" display) |
| terminal_reason | text | Why the run ended |
| last_heartbeat_at | timestamp | Liveness tracking |

## Frontend State Model

### Sidebar State

```typescript
interface SidebarState {
  sessions: GroupedSessions;
  filter: 'active' | 'archived' | 'all';
  searchQuery: string;
  activeSessionId: string | null;
}

interface GroupedSessions {
  [repoPath: string]: SidebarSession[];
}

interface SidebarSession {
  id: string;
  title: string | null;
  status: string;
  repoPath: string | null;
  lastActivityAt: string | null;
  hasActivity: boolean;  // derived: running status or recent update
}
```

### Right Panel State

```typescript
type RightPanelMode = 'files' | 'git' | 'preview' | 'closed';

interface RightPanelState {
  mode: RightPanelMode;
  width: number;  // persisted in localStorage
  fileTree: FileTreeState;
  gitStatus: GitStatusState;
  filePreview: FilePreviewState | null;
}

interface FileTreeState {
  expandedPaths: Set<string>;
  selectedPath: string | null;
  nodes: Map<string, FileNode[]>;  // path → children (lazy-loaded)
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  extension?: string;
  gitStatus?: 'added' | 'modified' | 'deleted' | 'untracked';
}

interface GitStatusState {
  branch: string;
  ahead: number;
  behind: number;
  changes: GitChange[];
  loading: boolean;
}

interface GitChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  linesAdded: number;
  linesRemoved: number;
}

interface FilePreviewState {
  path: string;
  content: string;
  language: string;
  viewMode: 'preview' | 'raw';
}
```

### Layout State

```typescript
interface LayoutState {
  sidebarOpen: boolean;
  sidebarWidth: number;      // default 260px, min 200, max 400
  rightPanelOpen: boolean;
  rightPanelWidth: number;   // default 400px, min 300, max 600
  rightPanelMode: RightPanelMode;
}
```

Layout state persisted to `localStorage` with versioning (key: `layout:v1`).

## Data Flow

```
Server (PostgreSQL)
  │
  ├── GET /api/sessions?limit=50&filter=active
  │     → SidebarState.sessions (grouped by repoPath)
  │
  ├── GET /api/sessions/[id]/files?path=/
  │     → FileTreeState.nodes[path]
  │
  ├── GET /api/sessions/[id]/files/content?path=src/app.ts
  │     → FilePreviewState
  │
  ├── GET /api/sessions/[id]/git/status
  │     → GitStatusState
  │
  ├── SSE /api/sessions/[id]/stream (existing)
  │     → chat.streamingParts (tokens + tool calls)
  │     → file change events → invalidate FileTreeState
  │
  ├── POST /api/sessions/[id]/git/commit
  │     → commit action → refresh GitStatusState
  │
  └── Server Actions
        ├── renameSessionAction(id, title)
        ├── archiveSessionAction(id)      (existing)
        └── deleteSessionAction(id)
```

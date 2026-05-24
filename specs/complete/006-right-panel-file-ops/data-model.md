# Data Model: Right Panel File Operations

## Existing Entities (no schema changes)

### Session (from `packages/db`)
- `id`: string (UUID)
- `repoPath`: string | null — workspace path in sandbox
- `sandboxUrl`: string | null — HTTP endpoint for sandbox container
- `status`: enum (active, completed, failed, deleted)

### ChatMessage (from `packages/db`)
- Already supports file reference parts; no changes needed.

## Frontend State Models

### FileTreeEntry (existing — `hooks/use-file-tree.ts`)
```
{
  name: string
  path: string
  type: "file" | "directory"
  extension?: string
  size?: number
  gitStatus?: string
}
```

### DirectoryCache (existing — `hooks/use-file-tree.ts`)
```
Record<string, { path: string, entries: FileTreeEntry[] }>
```

### FileContentResponse (existing — `file-preview.tsx`)
```
{
  path: string
  content: string
  language: string
  size: number
  truncated: boolean
}
```

### GitChange (existing — `hooks/use-git-status.ts`)
```
{
  path: string
  status: string
  linesAdded: number
  linesRemoved: number
}
```

### GitFileDiff (NEW — for per-file diff expansion)
```
{
  path: string
  diff: string         // unified diff text
  binary: boolean      // if true, diff is empty
  tooLarge: boolean    // if true, diff is truncated
}
```

### RightPanelMode (existing — `right-panel-context.tsx`)
```
"files" | "git" | "preview" | "closed"
```

### RightPanelViewState (conceptual — managed by component state)
```
{
  mode: RightPanelMode
  selectedFilePath: string | null
  showIconRail: boolean        // true when file is selected in files mode
  expandedDiffPaths: Set<string>  // which git files have diffs expanded
}
```

## State Transitions

### File Tree Navigation
```
[Panel Closed] --toggle button--> [Files Mode: Full Tree]
[Full Tree] --click file--> [Files Mode: Icon Rail + Preview]
[Icon Rail + Preview] --breadcrumb back / click rail folder--> [Full Tree]
[Full Tree] --tab switch--> [Git Mode]
[Git Mode] --tab switch--> [Full Tree]
[Any Mode] --close button / toggle button--> [Panel Closed]
```

### Git Diff Expansion
```
[File Collapsed] --click file row--> [Fetching Diff...]
[Fetching Diff...] --success--> [File Expanded: Inline Diff Visible]
[File Expanded] --click file row--> [File Collapsed]
[File Expanded] --commit success--> [Panel Refreshes: All Collapsed]
```

## Relationships

- Session 1:1 Sandbox (each session has exactly one sandbox container)
- Sandbox 1:N FileTreeEntry (directory listing returns entries)
- Sandbox 1:N GitChange (git status returns changes)
- GitChange 1:1 GitFileDiff (on-demand fetch per file)
- FileTreeEntry --select--> FileContentResponse (file preview fetch)

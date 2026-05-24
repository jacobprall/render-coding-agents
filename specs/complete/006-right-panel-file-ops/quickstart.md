# Quickstart: Right Panel File Operations

## Prerequisites

- Bun installed (`bun --version` ≥ 1.0)
- Local dev environment running (`bun run dev`)
- A session with an active sandbox (requires `SANDBOX_URL` env var)
- PostgreSQL running with schema pushed (`bun run db:push`)

## Key Files

### Components (modify)
- `apps/web/components/layout/app-shell.tsx` — Remove `RIGHT_PANEL_MAX` constant; compute dynamic max
- `apps/web/components/layout/right-panel.tsx` — Implement icon-rail + breadcrumb pattern
- `apps/web/components/session/git-panel.tsx` — Add expandable inline diff per file

### API Routes (connect to sandbox)
- `apps/web/app/api/sessions/[id]/files/route.ts` — Wire to sandbox `/files` endpoint
- `apps/web/app/api/sessions/[id]/files/content/route.ts` — Wire to sandbox `/files/content`
- `apps/web/app/api/sessions/[id]/git/status/route.ts` — Wire to sandbox `/git/status`
- `apps/web/app/api/sessions/[id]/git/diff/route.ts` — NEW: Per-file diff endpoint

### New Files
- `apps/web/lib/sandbox-client.ts` — HTTP client for sandbox API calls

### Hooks (minor updates)
- `apps/web/hooks/use-panel-resize.ts` — Accept dynamic `maxSize`
- `apps/web/hooks/use-git-status.ts` — Extend with per-file diff fetch

### Existing (reuse as-is)
- `apps/web/components/diff-viewer.tsx` — Unified diff parser/renderer
- `apps/web/components/session/file-tree.tsx` — Tree navigation (functional)
- `apps/web/components/session/file-preview.tsx` — File content display (functional)
- `apps/web/hooks/use-file-tree.ts` — Directory lazy loading (functional)

## Local Testing

1. Start dev server: `bun run dev`
2. Create/open a session with a repository
3. Verify:
   - Right panel opens via title bar toggle button
   - File tree loads from sandbox (not stub data)
   - Clicking a file shows icon-rail + preview
   - Breadcrumb "back" returns to full tree
   - Git mode shows changed files
   - Clicking a changed file expands inline diff
   - Panel can be resized beyond 600px (up to viewport limit)

## Environment Variables

```bash
# Already required
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=...

# Sandbox communication (existing)
SANDBOX_BASE_URL=http://localhost:3100  # or container URL
```

## Common Issues

- **"Session has no repository"**: Ensure the session was created with a repo URL or the sandbox has been initialized
- **Empty file tree**: Check sandbox container is running and `SANDBOX_BASE_URL` is reachable
- **Diff not loading**: Verify `git` is available in the sandbox container
- **Panel stuck at 600px**: Ensure `RIGHT_PANEL_MAX` constant has been removed from `app-shell.tsx`

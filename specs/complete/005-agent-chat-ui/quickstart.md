# Quickstart: Agent Chat UI

## Prerequisites

- Bun 1.1+ installed
- PostgreSQL running (local or Render)
- Existing `.env` with `DATABASE_URL`, `NEXTAUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- At least one session created in the database

## Development

```bash
# From repo root
bun install
bun run dev
```

The web app starts at `http://localhost:4000`. Navigate to `/sessions` to see the new layout.

## Key Files to Understand

| File | Purpose |
|------|---------|
| `apps/web/components/layout/app-shell.tsx` | Root layout — three-panel grid |
| `apps/web/components/layout/sidebar.tsx` | NEW: persistent sidebar with project groups |
| `apps/web/components/layout/right-panel.tsx` | NEW: mode-switching context panel |
| `apps/web/components/session/chat-panel.tsx` | Existing streaming chat (modified for layout) |
| `apps/web/components/session/file-tree.tsx` | NEW: recursive lazy-loading tree |
| `apps/web/components/session/git-panel.tsx` | NEW: branch status + changes list |
| `apps/web/components/session/review-bar.tsx` | NEW: inline diff stats + commit action |
| `apps/web/hooks/use-panel-resize.ts` | NEW: drag handle resize logic |

## Testing the Feature

### Manual Testing Checklist

1. **Sidebar**: Open app → sidebar shows sessions grouped by repo. Click between sessions. Verify active state.
2. **Chat streaming**: Send a message → tokens stream in real-time. Tool calls appear as collapsible blocks.
3. **File tree**: Open right panel (file icon in title bar) → expand directories → select a file → preview renders.
4. **Git panel**: Switch to git tab → shows branch + changes (or empty state). After agent makes changes, verify live update.
5. **Resize**: Drag sidebar right edge → it resizes. Drag right panel left edge → it resizes. Chat maintains min-width.
6. **Conversation management**: Right-click a session in sidebar → rename/archive/delete. Verify actions work.

### Automated Tests

```bash
# Unit tests for new hooks/utilities
bun run test -- --filter "panel-resize|file-tree|git-status"

# E2E tests for layout behavior
bun run test:e2e -- --filter "layout|sidebar|right-panel"
```

## Architecture Decisions

- **No new packages**: All features built with existing dependencies (React, SWR, Tailwind, Radix).
- **CSS Grid layout**: Three-column grid with `grid-template-columns` for panel sizing. Transitions for open/close.
- **Lazy file tree**: Directories fetched on expand via SWR. Live updates via SSE `file_change` events.
- **Git polling**: 5-second interval when panel is visible. Immediate refresh after commits.
- **Soft-delete**: Sessions set to `status: 'deleted'`, never hard-deleted from the database.

## Design Reference

The detailed visual specification (colors, dimensions, typography) is at:
`specs/epic-1a-ui-overhaul/cursor-agent-spec.md`

Key design tokens to implement:
- `--bg-main`: `#1e1e1e` (main chat background)
- `--bg-sidebar`: `#1b1b1b` (sidebar background)
- `--bg-surface`: `#252525` (elevated surfaces)
- `--accent-teal`: `#4ec9b0` (active indicators, file chips)
- `--text-primary`: `#d4d4d4` (body text)
- `--text-muted`: `#888888` (secondary text)

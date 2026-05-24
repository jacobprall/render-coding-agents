# Research: Agent Chat UI

## 1. Panel Resize Implementation

**Decision**: Use CSS Grid with a custom drag handle component (no library dependency).

**Rationale**: The existing codebase uses Tailwind CSS with flex/grid layouts. A custom `useResizeHandle` hook with `pointer-events` and CSS `grid-template-columns` provides the exact behavior needed (drag-to-resize with min/max constraints) without adding a dependency like `react-resizable-panels` (~15KB). The implementation is straightforward: track pointer position, clamp to min/max, update a CSS custom property.

**Alternatives considered**:
- `react-resizable-panels` (allotment): Good DX but adds bundle weight and an opinionated API that may conflict with the specific animation/transition requirements.
- Native CSS `resize`: Only works on overflow containers, doesn't support the inter-panel drag handle UX.

## 2. File Tree Data Loading Strategy

**Decision**: Lazy-load directory contents on expand via SWR with a `/api/sessions/[id]/files?path=` endpoint. Use event-driven updates (SSE from existing agent stream) to invalidate/update specific tree nodes.

**Rationale**: Repositories can have 10,000+ files. Loading the full tree upfront would be slow and memory-intensive. SWR provides deduplication and caching, so re-expanding a directory is instant. The existing `onFileChanges` callback in `ChatPanel` already tracks file modifications — the file tree subscribes to the same event stream and invalidates affected paths.

**Alternatives considered**:
- Full tree load at session start: Too slow for large repos, wastes bandwidth.
- WebSocket-only updates: Adds complexity; SSE is already the established pattern for agent streaming.

## 3. Git Status Integration

**Decision**: Poll `/api/sessions/[id]/git/status` on a 5-second interval when the git panel is visible, plus immediate refresh after commit actions. Use SWR's conditional fetching (only when panel is active).

**Rationale**: Git status doesn't change frequently enough to warrant a persistent SSE stream, but polling when the panel is visible provides near-real-time feedback. After agent file changes (detected via existing stream), trigger an immediate status refresh. The 5-second interval balances freshness with API load.

**Alternatives considered**:
- File-watcher SSE stream: Over-engineered for the use case; adds server-side complexity for minimal UX gain.
- Only refresh on user action: Stale data when agent is working and user has git panel open.

## 4. Sidebar Conversation Grouping

**Decision**: Group by `project_repos.repo_path` from existing schema. Sessions without a repo go under a "Scratch" group. Sort groups alphabetically, conversations within groups by `last_activity_at DESC`.

**Rationale**: The existing `SessionDrawer` already shows `repoPath` per session. Grouping by repo path aligns with the Cursor convention of project-based organization. The `sessions` table already has `repo_path` as a column, so grouping is a simple `GROUP BY` in the query.

**Alternatives considered**:
- Group by `projects` table: More structured but sessions aren't consistently linked to projects yet.
- Flat list with filters: Doesn't match the spec's project-grouped requirement.

## 5. Streaming Markdown Rendering

**Decision**: Continue using the existing `react-markdown` + `remark-gfm` setup in `components/markdown.tsx`. For streaming, render partial markdown as tokens arrive (the existing implementation already handles this via `streamingParts`).

**Rationale**: The current `MessageArea` → `AssistantParts` rendering pipeline already handles streaming tokens with markdown. No changes needed to the rendering engine — only visual refinements (asymmetric bubbling, flush agent messages).

**Alternatives considered**:
- Custom streaming parser: Unnecessary given existing working implementation.
- `mdx-bundler` or server-side rendering: Over-engineered for chat messages.

## 6. Conversation Lifecycle (Rename/Archive/Delete)

**Decision**: Implement via server actions (existing pattern — see `archiveSessionAction`). Add `rename` and `delete` server actions. Archive uses existing `status: 'archived'` column. Delete is soft-delete (set status to 'deleted', exclude from queries). Sidebar context menu (right-click or overflow `⋯` button) exposes actions.

**Rationale**: The codebase already has `archiveSessionAction` in `sessions/actions`. Extending with rename and delete follows the same pattern. Soft-delete preserves data recovery options. The sidebar already shows status dots, so filtering archived sessions is trivial.

**Alternatives considered**:
- Hard delete: Risky; no recovery path. Soft-delete is safer and simpler.
- Separate settings page for lifecycle: Breaks the inline UX; right-click context menu is more efficient.

## 7. Layout Transition Animations

**Decision**: Use CSS transitions with `transition: grid-template-columns 200ms ease` for panel open/close. No JS animation libraries. The main chat flexes naturally via grid.

**Rationale**: CSS Grid transitions are hardware-accelerated and meet the 16ms frame budget requirement. The existing codebase uses Tailwind's `transition-*` utilities. Adding `duration-200` and `ease-out` classes is consistent with the design system.

**Alternatives considered**:
- Framer Motion: Adds ~30KB to bundle for something achievable with CSS.
- React Spring: Same concern; overkill for panel slide animations.

## 8. Auto-Scroll Behavior

**Decision**: Use an `IntersectionObserver` on a sentinel element at the bottom of the scroll container. If the sentinel is visible, auto-scroll on new content. If the user scrolls up (sentinel leaves viewport), show a "scroll to bottom" floating button.

**Rationale**: The existing `ChatPanel` already has basic scroll-to-bottom on new messages. The `IntersectionObserver` approach is more reliable than calculating scroll position (avoids float precision issues and handles dynamic content heights). It's the industry standard for chat auto-scroll.

**Alternatives considered**:
- `scrollHeight - scrollTop === clientHeight` check: Fragile with subpixel rendering.
- Always scroll: Breaks user experience when reading history.

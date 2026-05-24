# Implementation Plan: Agent Chat UI

**Branch**: `005-agent-chat-ui` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-agent-chat-ui/spec.md`

## Summary

Overhaul the existing session-based chat UI into a three-panel Cursor-style coding agent interface. The current codebase already has working streaming chat (`ChatPanel`), file views (`FilesView`), session drawer (`SessionDrawer`), tool call renderers, and an icon rail layout. This plan restructures the layout from a drawer/tab-based model into a persistent sidebar + main chat + resizable right panel, adds a file tree with live updates, git changes panel, inline diff review, and conversation lifecycle management (rename/archive/delete).

## Technical Context

**Language/Version**: TypeScript 5, Bun runtime

**Primary Dependencies**: Next.js 15 (App Router), React 19, Tailwind CSS 4, SWR, Radix UI primitives, Lucide icons

**Storage**: PostgreSQL 16 via Drizzle ORM (existing schema: sessions, chats, chat_messages, agent_runs)

**Testing**: Vitest (unit), Playwright (integration/E2E)

**Target Platform**: Web — modern browsers (Chrome, Firefox, Safari, Edge latest 2 versions)

**Project Type**: Web application (Next.js monorepo)

**Performance Goals**: <1s message render, <500ms conversation switch, <100ms file tree interaction, 60fps animations

**Constraints**: <16ms frame budget for animations, max 700-800px chat content width, WCAG AA contrast ratios

**Scale/Scope**: Multi-user (private conversations), repositories up to 10k files, conversations up to 200+ messages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | PASS | Reuses existing components (ChatPanel, MessageArea, tool renderers). New components serve clear purposes. No new frameworks introduced. |
| II. Observability | PASS | Streaming via SSE already implemented. File change events use existing `onFileChanges` callback pattern. |
| III. Modularity | PASS | All UI work scoped to `apps/web/`. No changes to `packages/`. Component boundaries follow existing patterns. |
| IV. API-First | PASS | File tree and git status require new API endpoints, all following existing REST/SWR patterns. |
| V. Reliability | PASS | Streaming reconnection handled by existing `useAgentChat`. Conversation lifecycle uses server actions with optimistic updates. |
| VI. Security | PASS | All data scoped to authenticated user via existing NextAuth session. No new auth surfaces. |
| VII. Testing Discipline | PASS | Critical paths (panel layout, streaming, conversation CRUD) get E2E coverage. Primitives get unit tests. |
| VIII. OSS-Friendly | PASS | No new external dependencies beyond what's already used. Configuration via existing env vars. |
| IX. Performance | PASS | Streaming already in place. File tree lazy-loads. Layout uses CSS grid/flex (no JS layout). |

## Project Structure

### Documentation (this feature)

```text
specs/005-agent-chat-ui/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
apps/web/
├── app/(authenticated)/
│   └── sessions/
│       └── [id]/
│           └── page.tsx           # Session detail (existing, modified)
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx          # Modified: three-panel grid layout
│   │   ├── sidebar.tsx            # NEW: persistent project-grouped sidebar
│   │   ├── right-panel.tsx        # NEW: mode-switching context panel
│   │   ├── panel-resizer.tsx      # NEW: drag-to-resize handle
│   │   ├── status-bar.tsx         # NEW: bottom status strip
│   │   ├── icon-rail.tsx          # Modified or removed (merged into sidebar)
│   │   ├── session-drawer.tsx     # Removed (replaced by sidebar)
│   │   └── session-tabs.tsx       # Modified: title bar with panel toggle icons
│   ├── session/
│   │   ├── session-workspace.tsx  # Modified: right panel integration
│   │   ├── chat-panel.tsx         # Existing (minor layout adjustments)
│   │   ├── chat-input.tsx         # Modified: model selector inline, + button
│   │   ├── files-view.tsx         # Modified: tree with live updates
│   │   ├── file-tree.tsx          # NEW: recursive tree component
│   │   ├── file-preview.tsx       # NEW: markdown/raw preview with toolbar
│   │   ├── git-panel.tsx          # NEW: branch selector + changes list
│   │   └── review-bar.tsx         # NEW: inline diff stats + commit action
│   └── primitives/
│       └── (existing, reused)
├── hooks/
│   ├── use-panel-resize.ts        # NEW: drag-to-resize logic
│   ├── use-file-tree.ts           # NEW: lazy-loading tree data
│   └── use-git-status.ts          # NEW: polling/SSE for git state
└── lib/
    └── file-icons.ts              # NEW: extension → color mapping
```

**Structure Decision**: Extends the existing `apps/web/` Next.js application. No new packages needed. All changes scoped within the web app following existing component organization patterns (layout/, session/, primitives/, hooks/).

## Complexity Tracking

No constitution violations. No justifications needed.

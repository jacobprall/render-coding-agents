# Tasks: Agent Chat UI

**Input**: Design documents from `specs/005-agent-chat-ui/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Not explicitly requested in spec. Test tasks omitted.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Design tokens, utility helpers, and shared hooks needed across all user stories

- [x] T001 Add dark theme design tokens (CSS custom properties) to `apps/web/app/globals.css` matching the color palette from cursor-agent-spec.md (`--bg-main`, `--bg-sidebar`, `--bg-surface`, `--accent-teal`, `--text-primary`, `--text-muted`, etc.)
- [x] T002 [P] Create file icon color mapping utility in `apps/web/lib/file-icons.ts` — maps file extensions to color tokens (teal for .md, green for .sh, gray for dotfiles, yellow for scripts)
- [x] T003 [P] Create `apps/web/hooks/use-panel-resize.ts` hook — pointer-event-based drag handle that updates a CSS custom property, with min/max constraints and localStorage persistence

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Three-panel layout skeleton, new API endpoints, and core hooks that ALL user stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Restructure `apps/web/components/layout/app-shell.tsx` from flex+drawer layout to CSS Grid three-panel layout (`grid-template-columns: var(--sidebar-width) 1fr var(--right-panel-width)`) with panel open/close state
- [x] T005 [P] Create `apps/web/components/layout/panel-resizer.tsx` — a vertical drag handle component that uses `use-panel-resize` hook, renders as a 4px interactive border between panels
- [x] T006 [P] Create `apps/web/components/layout/status-bar.tsx` — bottom strip showing repo path, branch name, and session status dot (reads from session context)
- [x] T007 [P] Create API route `apps/web/app/api/sessions/[id]/files/route.ts` — GET handler that returns directory listing from session sandbox (path query param, returns entries array with name/path/type/extension/gitStatus)
- [x] T008 [P] Create API route `apps/web/app/api/sessions/[id]/files/content/route.ts` — GET handler that returns file content with language detection (path query param, 500KB truncation limit)
- [x] T009 [P] Create API route `apps/web/app/api/sessions/[id]/git/status/route.ts` — GET handler that returns branch, ahead/behind counts, and changes list from session sandbox
- [x] T010 [P] Create API route `apps/web/app/api/sessions/[id]/git/commit/route.ts` — POST handler that creates branch (optionally) and commits changes, returns commit SHA and stats
- [x] T011 [P] Create `apps/web/hooks/use-file-tree.ts` — SWR-based hook that lazy-loads directory contents on expand, invalidates on SSE `file_change` events
- [x] T012 [P] Create `apps/web/hooks/use-git-status.ts` — SWR-based hook with 5-second conditional polling (only when git panel is visible), immediate refresh trigger

**Checkpoint**: Three-panel grid renders, API endpoints respond, hooks are testable in isolation

---

## Phase 3: User Story 1 — Conversational Agent Interaction (Priority: P1) 🎯 MVP

**Goal**: Users conduct multi-turn conversations with streaming responses, tool call visibility, asymmetric message styling, and "Worked for X" duration markers.

**Independent Test**: Send a message, verify streaming response with tool call blocks renders correctly with asymmetric styling and timing markers.

### Implementation for User Story 1

- [x] T013 [US1] Restyle `apps/web/components/session/message-list/message-bubble.tsx` — user messages get rounded bubble container (`bg-[--bg-user-msg]`, rounded-lg), agent messages render flush (no background/border)
- [x] T014 [P] [US1] Add "Worked for X" duration markers to `apps/web/components/session/message-list/message-area.tsx` — render between agent turns using `total_duration_ms` from agent_runs, styled as muted text (`text-[--text-muted]`, 13px)
- [x] T015 [P] [US1] Restyle tool call blocks in `apps/web/components/tool-call/tool-layout.tsx` — render as collapsible inline blocks showing tool name + action summary, collapsed by default with expand chevron
- [x] T016 [US1] Add file attachment chips to user messages in `apps/web/components/session/message-list/message-bubble.tsx` — pill-shaped badges with document icon, filename, line range, teal-tinted background (`bg-[--bg-chip-teal]`)
- [x] T017 [US1] Implement "Message too long" truncation in `apps/web/components/session/message-list/assistant-parts.tsx` — truncate at threshold with a muted banner and expand affordance
- [x] T018 [US1] Implement auto-scroll with IntersectionObserver in `apps/web/components/session/chat-panel.tsx` — sentinel element at bottom, "scroll to bottom" floating button when user scrolls up

**Checkpoint**: Chat panel renders with Cursor-style asymmetric messages, streaming tokens, collapsible tool calls, timing markers, and smart auto-scroll

---

## Phase 4: User Story 2 — Project-Based Sidebar Navigation (Priority: P1) 🎯 MVP

**Goal**: Persistent sidebar showing conversations grouped by project, with activity indicators, search, and conversation lifecycle management (rename/archive/delete).

**Independent Test**: Open sidebar, see sessions grouped by repo, create new agent, switch between conversations, rename/archive a session.

### Implementation for User Story 2

- [x] T019 [US2] Create `apps/web/components/layout/sidebar.tsx` — persistent left panel replacing `SessionDrawer`, with project-grouped session list, search input, "New Agent" button, user profile footer
- [x] T020 [US2] Extend `apps/web/app/api/sessions/route.ts` — add `filter` (active/archived/all) and `grouped` (boolean) query params, return sessions grouped by `repoPath`
- [x] T021 [US2] Add rename server action in `apps/web/app/(authenticated)/sessions/actions.ts` — `renameSessionAction(id, title)` with validation (1-100 chars, user ownership)
- [x] T022 [P] [US2] Add delete server action in `apps/web/app/(authenticated)/sessions/actions.ts` — `deleteSessionAction(id)` soft-deletes by setting status to 'deleted'
- [x] T023 [US2] Add context menu to sidebar session items in `apps/web/components/layout/sidebar.tsx` — right-click or overflow button (`⋯`) showing Rename/Archive/Delete actions with confirmation for destructive actions
- [x] T024 [US2] Add archived sessions filter toggle in `apps/web/components/layout/sidebar.tsx` — filter button in sidebar header that toggles between active/archived views, restore action on archived items
- [x] T025 [US2] Add activity indicator dots to sidebar items in `apps/web/components/layout/sidebar.tsx` — green/teal dot for `running` status sessions, positioned left of the title

**Checkpoint**: Sidebar renders with grouped sessions, all CRUD actions work, search filters, activity indicators show running state

---

## Phase 5: User Story 3 — File Explorer Context Panel (Priority: P2)

**Goal**: Browsable file tree in the right panel with lazy-loaded directories, color-coded file icons, and split-view file preview with markdown rendering.

**Independent Test**: Open right panel file explorer tab, expand directories, select a file, toggle preview/raw mode, verify breadcrumb navigation.

### Implementation for User Story 3

- [x] T026 [US3] Create `apps/web/components/session/file-tree.tsx` — recursive tree component using `use-file-tree` hook, expand/collapse with chevrons, color-coded file type icons from `file-icons.ts`, selected state highlight
- [x] T027 [US3] Create `apps/web/components/session/file-preview.tsx` — file content renderer with toolbar (breadcrumbs, Preview/Markdown toggle), uses existing `markdown.tsx` for rendered view and `code-block.tsx` for raw source
- [x] T028 [US3] Create `apps/web/components/layout/right-panel.tsx` — mode-switching container with tab icons in header (files/git/preview), renders active mode component, handles open/close state
- [x] T029 [US3] Add right panel tab icons to `apps/web/components/layout/session-tabs.tsx` — 3-4 small icons (files, git, preview) that toggle right panel mode, active icon gets highlight treatment
- [x] T030 [US3] Connect file reference chips in chat to right panel — clicking a file chip in `message-bubble.tsx` opens the right panel in file preview mode at the referenced path and line range
- [x] T031 [US3] Wire live file tree updates — subscribe to `file_change` SSE events in `use-file-tree.ts`, invalidate affected directory SWR caches when agent creates/modifies/deletes files

**Checkpoint**: File tree loads lazily, files preview correctly in split view, live updates reflect agent changes, chat chips navigate to file preview

---

## Phase 6: User Story 4 — Inline Git Review and Commit (Priority: P2)

**Goal**: After agent changes, users see inline diff stats with a Review button and can create a branch and commit without leaving the chat. Git panel shows working tree state.

**Independent Test**: Agent makes file changes → Review button appears with +/- stats → click to see diff → "Create Branch & Commit" commits successfully → git panel updates.

### Implementation for User Story 4

- [x] T032 [US4] Create `apps/web/components/session/review-bar.tsx` — inline bar below agent response showing "Review +N -M" pill (green/red), "Create Branch & Commit" dropdown button, appears when `liveFileChanges.length > 0`
- [x] T033 [US4] Create `apps/web/components/session/git-panel.tsx` — right panel mode showing branch selector pill, changes list with file status icons, empty state "No uncommitted changes", uses `use-git-status` hook
- [x] T034 [US4] Integrate review-bar into `apps/web/components/session/session-workspace.tsx` — render `ReviewBar` between chat messages and input when file changes exist, wire commit action to `/api/sessions/[id]/git/commit`
- [x] T035 [US4] Add diff expansion to review-bar in `apps/web/components/session/review-bar.tsx` — clicking "Review" expands an inline diff viewer (reusing existing `diff-viewer.tsx`) showing file-by-file changes
- [x] T036 [US4] Wire commit success to git panel refresh — after successful POST to git/commit, trigger `use-git-status` immediate revalidation, clear `liveFileChanges`, update review-bar state

**Checkpoint**: Full commit flow works inline — agent changes → review diff → commit → git panel shows clean state

---

## Phase 7: User Story 5 — Responsive Multi-Panel Layout (Priority: P2)

**Goal**: Panels resize smoothly via drag handles, toggle open/closed with animations, chat maintains readable width, layout adapts to viewport size.

**Independent Test**: Drag resize handles, toggle panels, verify min-width constraints, check animation smoothness.

### Implementation for User Story 5

- [x] T037 [US5] Add CSS Grid transition animations to `apps/web/components/layout/app-shell.tsx` — `transition: grid-template-columns 200ms ease` for panel open/close, no animation on resize drag (direct manipulation)
- [x] T038 [US5] Implement sidebar toggle in `apps/web/components/layout/app-shell.tsx` — toggle button in title bar area, animates sidebar between 0px and stored width, persists state to localStorage
- [x] T039 [US5] Implement right panel toggle in `apps/web/components/layout/app-shell.tsx` — tab icons toggle panel open/close, animates between 0px and stored width, persists state to localStorage
- [x] T040 [US5] Add min/max width constraints — sidebar: min 200px, max 400px; right panel: min 300px, max 600px; chat: min 450px (panels auto-collapse if viewport too narrow)
- [x] T041 [US5] Persist layout state to localStorage in `apps/web/components/layout/app-shell.tsx` — save `{sidebarOpen, sidebarWidth, rightPanelOpen, rightPanelWidth, rightPanelMode}` under key `layout:v1`

**Checkpoint**: All panels resize/toggle smoothly, constraints prevent broken layouts, state persists across page loads

---

## Phase 8: User Story 6 — Model Selection and Input Controls (Priority: P3)

**Goal**: Inline model selector in input bar persists across messages, "+" button opens file attachment picker.

**Independent Test**: Switch model via dropdown, send message, verify model persists. Click "+", verify file picker appears.

### Implementation for User Story 6

- [x] T042 [US6] Relocate model selector into `apps/web/components/session/chat-input.tsx` — move `ModelSelector` from the above-input status bar to inside the input bar (right side), compact style with dropdown chevron
- [x] T043 [US6] Add attachment button to `apps/web/components/session/chat-input.tsx` — circular "+" button on input left side, opens a popover/menu with "Attach file" and "Reference code" options
- [x] T044 [US6] Persist model selection in `apps/web/components/session/session-workspace.tsx` — save selected model to localStorage per-session, restore on session load (fallback to default model)

**Checkpoint**: Model selector works inline, persists across messages, "+" button opens attachment menu

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Accessibility, performance optimizations, and consistency refinements

- [x] T045 [P] Add keyboard navigation to sidebar in `apps/web/components/layout/sidebar.tsx` — arrow keys navigate items, Enter selects, Escape closes search
- [x] T046 [P] Add WCAG AA contrast validation — audit all new components against 4.5:1 ratio, fix any violations
- [x] T047 [P] Add `content-visibility: auto` to message list items in `apps/web/components/session/message-list/message-area.tsx` for virtualized rendering performance with 200+ messages
- [x] T048 Remove deprecated `apps/web/components/layout/session-drawer.tsx` and clean up references in app-shell and related imports
- [x] T049 [P] Add screen reader announcements for "Worked for X" duration markers (aria-live region) and focus management on message send
- [x] T050 Update `apps/web/components/layout/icon-rail.tsx` — merge into sidebar component or remove if fully replaced by new sidebar

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 design tokens — BLOCKS all user stories
- **US1 Chat (Phase 3)**: Depends on Phase 2 layout skeleton
- **US2 Sidebar (Phase 4)**: Depends on Phase 2 layout skeleton
- **US3 File Explorer (Phase 5)**: Depends on Phase 2 (API routes + hooks + right panel container)
- **US4 Git Review (Phase 6)**: Depends on Phase 2 (API routes + hooks) and Phase 5 (right panel)
- **US5 Layout Polish (Phase 7)**: Depends on Phase 2 (layout exists to polish)
- **US6 Model Selection (Phase 8)**: Depends on Phase 3 (chat input exists)
- **Polish (Phase 9)**: Depends on all user stories complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — No dependencies on other stories
- **US2 (P1)**: Can start after Phase 2 — No dependencies on other stories (parallel with US1)
- **US3 (P2)**: Can start after Phase 2 — Independent of US1/US2
- **US4 (P2)**: Benefits from US3 (shares right panel), but can be built independently
- **US5 (P2)**: Can start after Phase 2 — Independent (layout polish)
- **US6 (P3)**: Depends on US1 (chat input component must exist)

### Parallel Opportunities

- **Phase 1**: T002, T003 can run in parallel
- **Phase 2**: T005-T012 all target different files, fully parallelizable
- **Phase 3 + Phase 4**: US1 and US2 are completely independent, can run in parallel
- **Phase 5 + Phase 6**: US3 and US4 can mostly run in parallel (share right panel container)
- **Phase 9**: T045-T050 all target different concerns, fully parallelizable

---

## Parallel Example: US1 + US2 (P1 Stories)

```bash
# After Phase 2 completes, launch both P1 stories in parallel:

# Agent A: User Story 1 (Chat)
Task: "T013 - Restyle message-bubble.tsx (asymmetric styling)"
Task: "T014 - Add duration markers to message-area.tsx"
Task: "T015 - Restyle tool-layout.tsx (collapsible blocks)"

# Agent B: User Story 2 (Sidebar)
Task: "T019 - Create sidebar.tsx (grouped sessions)"
Task: "T020 - Extend sessions API (grouped response)"
Task: "T021 - Add rename server action"
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 Only)

1. Complete Phase 1: Setup (design tokens, utilities)
2. Complete Phase 2: Foundational (layout grid, API routes, hooks)
3. Complete Phase 3: US1 — Chat interaction (streaming, styling, tool calls)
4. Complete Phase 4: US2 — Sidebar navigation (grouped sessions, lifecycle)
5. **STOP and VALIDATE**: Three-panel layout with working chat and sidebar
6. Deploy/demo — this is a functional product

### Incremental Delivery

1. Setup + Foundational → Three-panel skeleton renders
2. Add US1 + US2 → Core chat + navigation works (MVP!)
3. Add US3 → File exploration alongside chat
4. Add US4 → Git workflow inline in chat
5. Add US5 → Smooth resize/toggle polish
6. Add US6 → Power user model selection
7. Polish → Accessibility, performance, cleanup

### Parallel Agent Strategy

With 2-3 parallel agents after Phase 2:

1. All agents complete Phase 1 + 2 together (sequential, shared files)
2. Once Phase 2 is done:
   - Agent A: US1 (Chat) + US6 (Model Selection)
   - Agent B: US2 (Sidebar) + US5 (Layout Polish)
   - Agent C: US3 (File Explorer) + US4 (Git Review)
3. Phase 9 (Polish): Any available agent

---

## Notes

- [P] tasks = different files, no dependencies on other incomplete tasks
- [Story] label maps task to specific user story for traceability
- Existing components are MODIFIED, not rewritten from scratch — preserve working streaming/rendering logic
- The visual reference at `specs/epic-1a-ui-overhaul/cursor-agent-spec.md` has exact hex colors, dimensions, and typography specs
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently

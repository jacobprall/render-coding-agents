# Tasks: Right Panel File Operations

**Input**: Design documents from `specs/006-right-panel-file-ops/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the sandbox client abstraction and new API route

- [ ] T001 Create sandbox HTTP client utility in apps/web/lib/sandbox-client.ts with typed methods for files, content, git-status, and git-diff
- [ ] T002 [P] Create git diff API route in apps/web/app/api/sessions/[id]/git/diff/route.ts that proxies to sandbox

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Connect existing stub API routes to the real sandbox — MUST be complete before user story work delivers value

**⚠️ CRITICAL**: User stories depend on real data flowing from sandbox

- [ ] T003 Connect files listing route (apps/web/app/api/sessions/[id]/files/route.ts) to sandbox via sandbox-client, replacing hardcoded stub data
- [ ] T004 [P] Connect file content route (apps/web/app/api/sessions/[id]/files/content/route.ts) to sandbox via sandbox-client, replacing placeholder content
- [ ] T005 [P] Connect git status route (apps/web/app/api/sessions/[id]/git/status/route.ts) to sandbox via sandbox-client, replacing empty changes array
- [ ] T006 [P] Add binary file detection to file content route — return 422 with `{ error: "Binary file", binary: true }` for non-text files
- [ ] T007 Wire SSE file_changed events to call notifyFileTreeChange() in apps/web/components/session/session-workspace.tsx (or nearest SSE consumer)

**Checkpoint**: API routes return real sandbox data; file tree shows actual repository contents

---

## Phase 3: User Story 1 — Live File Tree Browsing (Priority: P1) 🎯 MVP

**Goal**: Users browse the agent's working directory in real time with lazy-loaded directory expansion and live updates when the agent creates/modifies files.

**Independent Test**: Open right panel in files mode → verify real directory listing loads. Expand a folder → verify children appear. Agent creates file → verify tree updates without manual refresh.

### Implementation for User Story 1

- [ ] T008 [US1] Update FileTree component (apps/web/components/session/file-tree.tsx) to show loading skeleton per-directory when expanding a folder that hasn't loaded yet
- [ ] T009 [US1] Add error state with retry button per-directory in FileTree when a directory fetch fails
- [ ] T010 [P] [US1] Add empty directory state ("No files") to FileTree for expanded directories with zero children
- [ ] T011 [US1] Verify use-file-tree hook (apps/web/hooks/use-file-tree.ts) correctly invalidates parent directory on notifyFileTreeChange — add integration smoke test if needed

**Checkpoint**: File tree shows real repository contents with lazy loading and live updates

---

## Phase 4: User Story 2 — File Content Viewer (Priority: P1)

**Goal**: Selecting a file shows syntax-highlighted content in a preview pane. Tree collapses to a narrow icon rail (~40px); breadcrumb provides navigation back.

**Independent Test**: Select a .ts file → verify syntax-highlighted code. Select a .md file → verify rendered markdown. Click breadcrumb back → return to full tree view. File >500KB → verify truncation notice.

### Implementation for User Story 2

- [ ] T012 [US2] Implement icon-rail view state in right-panel.tsx — when a file is selected, collapse tree to ~40px narrow rail showing only folder/file icons vertically
- [ ] T013 [US2] Add "back to full tree" affordance in icon-rail (click on rail header or dedicated expand button) in apps/web/components/layout/right-panel.tsx
- [ ] T014 [P] [US2] Wire breadcrumb segments in file-preview.tsx to navigate up the tree (clicking a segment opens that directory in full tree view)
- [ ] T015 [US2] Handle binary file response (422) in FilePreview — show "Binary file — cannot preview" message with file icon in apps/web/components/session/file-preview.tsx
- [ ] T016 [P] [US2] Add file reference chip click handler in message bubble (apps/web/components/session/message-list/message-bubble.tsx) — opens right panel to that file via RightPanelContext.openFile()

**Checkpoint**: Full file viewing workflow works: tree → select file → icon-rail + preview → breadcrumb back → full tree

---

## Phase 5: User Story 3 — File Diff Viewer (Priority: P2)

**Goal**: Git mode shows changed files with expandable unified inline diffs per file. Added lines green, removed lines red, context lines neutral.

**Independent Test**: Agent modifies files → switch to git mode → verify file list with +/- stats → click file → verify inline unified diff expands → commit → verify panel refreshes to clean state.

### Implementation for User Story 3

- [ ] T017 [US3] Add expandable state management to GitPanel (apps/web/components/session/git-panel.tsx) — track which file paths have their diff expanded in local state
- [ ] T018 [US3] Add click handler on git file list items to toggle expansion and fetch diff from /api/sessions/[id]/git/diff?path= via SWR
- [ ] T019 [US3] Render SingleFileDiffViewer (from apps/web/components/diff-viewer.tsx) inside expanded file rows, with loading/error states
- [ ] T020 [P] [US3] Add "Show full diff" affordance for files with tooLarge: true — collapsed by default with a button to expand
- [ ] T021 [US3] After successful commit (via review-bar), refresh git status and collapse all expanded diffs in GitPanel
- [ ] T022 [P] [US3] Style diff expansion with proper borders and spacing — unified with the existing git-panel list item layout

**Checkpoint**: Full diff review workflow works: git mode → see changes → expand file → view inline diff → commit → clean state

---

## Phase 6: User Story 4 — Unconstrained Panel Width (Priority: P2)

**Goal**: Right panel has no hard 600px max — users can drag to any width that still preserves the 450px chat minimum.

**Independent Test**: Drag resize handle past 600px → verify panel keeps growing. Resize until chat area reaches 450px → verify panel stops. Reload page → verify restored width. Resize browser window smaller → verify panel contracts gracefully.

### Implementation for User Story 4

- [ ] T023 [US4] Remove RIGHT_PANEL_MAX constant (600) from apps/web/components/layout/app-shell.tsx
- [ ] T024 [US4] Compute dynamic maxSize for right panel resize: viewport width minus sidebar space minus CHAT_MIN_WIDTH minus handle widths — pass to usePanelResize in AppShell
- [ ] T025 [US4] Update usePanelResize hook (apps/web/hooks/use-panel-resize.ts) to accept a reactive maxSize (recalculate on window resize via effect)
- [ ] T026 [P] [US4] Update localStorage persistence in use-panel-resize to clamp restored value against current dynamic max on hydration
- [ ] T027 [US4] Verify enforceViewportConstraints() in app-shell.tsx still gracefully closes panel when viewport shrinks below minimum

**Checkpoint**: Panel resizes freely with no hard cap; respects chat minimum; persists correctly

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [ ] T028 [P] Add keyboard navigation to file tree — arrow keys to move selection, Enter to expand/select, Escape to deselect
- [ ] T029 [P] Add aria-labels and screen reader announcements for panel mode changes and file selection
- [ ] T030 Ensure all new/modified components respect existing design tokens (text-text-primary, bg-surface-2, border-stroke-subtle, etc.)
- [ ] T031 [P] Add content-visibility: auto to git diff list items for performance with many expanded diffs
- [ ] T032 Verify panel transitions are smooth (no layout jumps) when toggling between icon-rail and full tree view

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on T001 (sandbox-client) — BLOCKS all user stories
- **User Stories (Phase 3–6)**: All depend on Foundational phase completion
  - US1 and US4 have NO cross-dependencies
  - US2 depends on US1 (file tree must work for file selection)
  - US3 depends on T002 (git diff route)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — No dependencies on other stories
- **US2 (P1)**: Can start after Phase 2 — Integrates with US1's file tree but only requires it to be functional (already is)
- **US3 (P2)**: Can start after Phase 2 — Independent of US1/US2; uses git endpoints only
- **US4 (P2)**: Can start after Phase 2 — Independent of all other stories; modifies app-shell only

### Parallel Opportunities

- T001 and T002 can run in parallel (Phase 1)
- T003, T004, T005, T006 can run in parallel (Phase 2 — different files)
- US1, US3, US4 can all run in parallel after Phase 2
- US2 can start in parallel with US3/US4 (file tree is already functional)
- All Polish tasks marked [P] can run in parallel

---

## Parallel Example: Phase 2 (Foundational)

```bash
# All these touch different route files — run in parallel:
Task: "Connect files listing route to sandbox" (T003)
Task: "Connect file content route to sandbox" (T004)
Task: "Connect git status route to sandbox" (T005)
Task: "Add binary file detection" (T006)
```

## Parallel Example: User Stories after Phase 2

```bash
# These user stories can be implemented in parallel:
Agent A: US1 (file tree enhancements) — T008-T011
Agent B: US3 (git diff viewer) — T017-T022
Agent C: US4 (unconstrained width) — T023-T027

# Then US2 (icon-rail + file viewer) — T012-T016
```

---

## Implementation Strategy

### MVP First (US1 + US4)

1. Complete Phase 1: Setup (sandbox client + diff route)
2. Complete Phase 2: Foundational (connect all routes to sandbox)
3. Complete US1: Live file tree with real data
4. Complete US4: Remove max-width cap
5. **STOP and VALIDATE**: Real file tree browsing works, panel resizes freely

### Incremental Delivery

1. Setup + Foundational → Sandbox data flows
2. US1 → Live file tree browsing works → Validate
3. US4 → Panel width unconstrained → Validate
4. US2 → Icon-rail + file preview → Validate
5. US3 → Inline diff expansion → Validate
6. Polish → Keyboard nav, accessibility, transitions

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- The file tree, file preview, git panel, and diff viewer components already exist as functional stubs — tasks focus on connecting to real data and implementing the icon-rail UX pattern
- No test tasks generated (not explicitly requested in spec)
- Commit after each task or logical group

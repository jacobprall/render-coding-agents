# Tasks: Agent Chat Interface Updates

**Input**: Design documents from `/specs/010-chat-interface-updates/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Plan recommends Vitest for `commitSessionChanges` only; no broad TDD scope in spec.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete-task dependencies)
- **[Story]**: User story label (US1–US4)

## Path Conventions

- Web app: `apps/web/`
- Platform: `packages/platform/`
- Specs: `specs/010-chat-interface-updates/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Align implementation with design artifacts and existing code paths

- [x] T001 Review `specs/010-chat-interface-updates/contracts/api.md` and `specs/010-chat-interface-updates/contracts/ui.md` against clarified spec.md
- [x] T002 [P] Trace current git commit stub in `apps/web/app/api/sessions/[id]/git/commit/route.ts` and working patterns in `apps/web/lib/sandbox-client.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared prerequisites before user story work

**⚠️ CRITICAL**: User story phases should start after this checkpoint

- [x] T003 [P] Confirm `getUserPreferences` in `apps/web/lib/db/loaders.ts` exposes `autoCommitPush` for use in server-side commit route

**Checkpoint**: Foundation ready — user stories can proceed (US1–US4 largely independent)

---

## Phase 3: User Story 1 - Commit Agent Changes Successfully (Priority: P1) 🎯 MVP

**Goal**: Real local git commit from review UI; optional push when `autoCommitPush` is enabled; actionable errors (no stub SHA).

**Independent Test**: Agent changes a file → Review bar → Create Branch & Commit → network returns real `commitSha`, changes clear, toast matches push preference. Commit during active run succeeds; later edits show as new changes.

### Implementation for User Story 1

- [x] T004 [US1] Implement `commitSessionChanges()` in `apps/web/lib/sandbox-client.ts` (`git add`, optional `checkout -b`, `commit`, `rev-parse HEAD`, optional `push`)
- [x] T005 [US1] Replace stub in `apps/web/app/api/sessions/[id]/git/commit/route.ts` — call `commitSessionChanges`, load `autoCommitPush` via `getUserPreferences`, return `pushed` / `pushError` per `contracts/api.md`
- [x] T006 [US1] Update `handleCommit` and toast copy in `apps/web/components/session/session-workspace.tsx` for local-only, pushed, and push-failed outcomes; parse API error detail
- [ ] T007 [P] [US1] Add Vitest tests for `commitSessionChanges` in `apps/web/lib/sandbox-client.test.ts` (mock git failures, no false success) — deferred

**Checkpoint**: Commit flow works end-to-end — MVP deliverable

---

## Phase 4: User Story 2 - Invoke Skills via Slash Commands in Chat (Priority: P1)

**Goal**: `/` skill picker in chat; one-shot `turnSkillRefs` per message; chip clears after send.

**Independent Test**: Type `/` → pick skill → chip visible → send → chip cleared; agent run includes skill for that turn only.

### Implementation for User Story 2

- [x] T008 [US2] Extend `SendMessageParams` with `turnSkillRefs` and merge deduped into `activeSkillRefs` in `packages/platform/src/services/session.ts` `sendMessage` (do not persist to session row)
- [x] T009 [P] [US2] Create `apps/web/components/session/skill-slash-menu.tsx` (filter list, keyboard ↑/↓/Enter/Esc, empty state)
- [x] T010 [US2] Integrate slash detection, picker, and removable skill chip in `apps/web/components/session/chat-input.tsx`
- [x] T011 [US2] Pass `turnSkillRefs` in POST body from `apps/web/components/session/use-agent-chat.ts` `sendMessage`
- [x] T012 [US2] Thread session id / skills source into `chat-input` via `apps/web/components/session/chat-panel.tsx` (fetch `GET /api/sessions/[id]/skills` or pass `activeSkills` prop)
- [x] T013 [P] [US2] Add focus management and aria labels for picker/chip per `specs/010-chat-interface-updates/contracts/ui.md`

**Checkpoint**: Slash skills work independently of commit and layout stories

---

## Phase 5: User Story 3 - Appropriately Sized Tool Call Blocks (Priority: P2)

**Goal**: Collapsed tool calls ~50% message column width; expanded panel full column width with bounded scroll.

**Independent Test**: Agent run with tool calls → collapsed blocks ~half width → expand → full column width, `max-h-128` scroll.

### Implementation for User Story 3

- [ ] T014 [P] [US3] Apply `max-w-[50%]` when collapsed and `w-full` when expanded in `apps/web/components/tool-call/tool-layout.tsx` — **skipped per user**
- [ ] T015 [US3] Ensure left-aligned tool blocks in `apps/web/components/session/message-list/assistant-parts.tsx` (`items-start` on tool call wrapper) — **skipped per user**

**Checkpoint**: Tool call layout matches SC-004 without affecting other stories

---

## Phase 6: User Story 4 - Unified File Navigation and Review (Priority: P2)

**Goal**: Remove Git tab (desktop + mobile); review opens Files → Changes; diffs remain in files sub-view.

**Independent Test**: No Git tab in session workspace or mobile nav; Review bar opens Changes sub-view; file chips open explorer.

### Implementation for User Story 4

- [x] T016 [US4] Remove `git` from `ViewTab`, Git tab button, and `GitPanel` lazy import in `apps/web/components/session/session-workspace.tsx`
- [x] T017 [US4] Add `initialSubView?: "tree" | "changes"` to `apps/web/components/session/files-view.tsx` and honor on mount
- [x] T018 [US4] Update `handleReviewClick` in `apps/web/components/session/session-workspace.tsx` to open files with `initialSubView: "changes"`
- [x] T019 [P] [US4] Remove `git` from `MobileView` and nav items in `apps/web/components/layout/mobile-bottom-nav.tsx`
- [x] T020 [P] [US4] Remove `git` view branch from `MobileShell` in `apps/web/components/layout/app-shell.tsx`
- [x] T021 [P] [US4] Remove git mode toggle and `GitPanel` usage from `apps/web/components/layout/right-panel.tsx`
- [x] T022 [US4] Grep `apps/web/` for remaining `git` tab/mode references (`setRightPanelModeContext("git")`, etc.) and align with files-only routing

**Checkpoint**: File review complete without standalone git navigation

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validation and repo hygiene

- [ ] T023 Run manual validation checklist in `specs/010-chat-interface-updates/quickstart.md`
- [x] T024 [P] Run `bun run typecheck` for `apps/web` and `packages/platform`
- [x] T025 [P] Update `specs/010-chat-interface-updates/quickstart.md` if implementation paths diverged from plan

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — blocks story work only if T003 finds missing preference access
- **User Stories (Phases 3–6)**: Can start after Phase 2; stories are largely independent
  - **US1** and **US2** (both P1): Parallelizable after Phase 2
  - **US3** and **US4** (both P2): Parallelizable with each other and with US1/US2 (different files)
- **Polish (Phase 7)**: After desired user stories complete

### User Story Dependencies

| Story | Depends on | Notes |
|-------|------------|-------|
| US1 | Phase 2 | No dependency on US2–US4 |
| US2 | Phase 2 | Platform `sendMessage` only |
| US3 | Phase 2 | UI-only |
| US4 | Phase 2 | US4 T018 benefits from US1 commit refresh patterns but testable alone |

### Within Each User Story

- Platform types (US2 T008) before web send (US2 T011)
- `commitSessionChanges` (US1 T004) before commit route (US1 T005)
- `files-view` prop (US4 T017) before review routing (US4 T018)

### Parallel Opportunities

**After Phase 2**, launch in parallel:

```text
Stream A (US1): T004 → T005 → T006; T007 parallel to T006
Stream B (US2): T008 → T009|T010|T012 → T011|T013
Stream C (US3): T014 | T015
Stream D (US4): T017 → T016|T018; T019|T020|T021 parallel → T022
```

**US1 + US2** can be split across two developers immediately after Phase 2.

---

## Parallel Example: User Story 1

```bash
# After T004 completes:
Task T005: "Wire commit route in apps/web/app/api/sessions/[id]/git/commit/route.ts"
Task T007: "Vitest tests in apps/web/lib/sandbox-client.test.ts"
```

---

## Parallel Example: User Story 2

```bash
# After T008 completes:
Task T009: "skill-slash-menu.tsx"
Task T012: "chat-panel.tsx props / skills fetch"
# Then:
Task T010: "chat-input.tsx integration"
Task T011: "use-agent-chat.ts turnSkillRefs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1–2
2. Complete Phase 3 (US1)
3. **STOP and VALIDATE** per quickstart commit checklist
4. Demo/deploy commit fix

### Incremental Delivery

1. US1 → commit fixed (MVP)
2. US2 → slash skills
3. US3 + US4 → layout + nav cleanup (can ship together)
4. Phase 7 polish

### Suggested PR Splits

| PR | Scope |
|----|--------|
| 1 | US1 — commit + push preference |
| 2 | US2 — slash skills |
| 3 | US3 — tool call width |
| 4 | US4 — remove git tab + mobile |

---

## Notes

- Commit route must never return `commitSha: "0000000"` on failure (FR-003)
- `turnSkillRefs` must not persist to `sessions.activeSkills` (clarification 2026-05-24)
- Collapsed tool width only; collapse behavior already exists
- `[P]` tasks = different files; coordinate before merging overlapping session-workspace changes (US1 T006 vs US4 T016–T018)

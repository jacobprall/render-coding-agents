# Tasks: Agent Observability Dashboard

**Input**: Design documents from `specs/002-observability-dashboard/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup

**Purpose**: Database migration and platform API for cross-session event querying

- [ ] T001 Create database migration adding cross-session index in apps/web/lib/db/migrations/0005_observability_global_index.sql
- [ ] T002 Add `queryEvents` method (cross-session, paginated, filtered) to packages/platform/src/services/observability.ts
- [ ] T003 Add test coverage for `queryEvents` in tests/platform/observability.test.ts

---

## Phase 2: Foundational (API Routes + Navigation)

**Purpose**: HTTP endpoints and navigation entry point that ALL user stories depend on

**⚠️ CRITICAL**: No dashboard UI work can begin until these routes exist

- [ ] T004 Create cross-session events API route with Zod validation in apps/web/app/api/observability/events/route.ts
- [ ] T005 [P] Add cross-session events route to gateway in apps/gateway/src/routes/observability.ts
- [ ] T006 [P] Add observability icon (Activity from lucide-react) to icon rail in apps/web/components/layout/icon-rail.tsx
- [ ] T007 Create observability page shell (server component with metadata) in apps/web/app/(authenticated)/observability/page.tsx
- [ ] T008 [P] Create loading skeleton in apps/web/app/(authenticated)/observability/loading.tsx

**Checkpoint**: API returns events, nav link works, page renders skeleton → ready for UI implementation

---

## Phase 3: User Story 1 - View Event Timeline (Priority: P1) 🎯 MVP

**Goal**: Unified cross-session event table with pagination, inline expansion, and trigger attribution

**Independent Test**: Navigate to /observability → see all events in a sortable table → click a row → see metadata expanded inline

### Implementation for User Story 1

- [ ] T009 [P] [US1] Create TanStack Table column definitions (trigger/user, session, type, status, duration, timestamp) in apps/web/components/observability/columns.tsx
- [ ] T010 [P] [US1] Create inline event detail component (model, tokens, tool I/O, errors, trigger context) in apps/web/app/(authenticated)/observability/event-detail.tsx
- [ ] T011 [US1] Create events table component with SWR fetching, cursor pagination, and row expansion in apps/web/app/(authenticated)/observability/events-table.tsx
- [ ] T012 [US1] Create filter controls (type select, status select, session select) in apps/web/app/(authenticated)/observability/filters.tsx
- [ ] T013 [US1] Create URL state hook for syncing filters/sort to searchParams in apps/web/app/(authenticated)/observability/use-observability-params.ts
- [ ] T014 [US1] Wire events table + filters into page component with Tabs (Events/Usage) in apps/web/app/(authenticated)/observability/page.tsx
- [ ] T015 [US1] Add responsive column visibility (hide session/timestamp on mobile, show in detail) in apps/web/components/observability/columns.tsx

**Checkpoint**: Full event timeline works — paginated, sortable, filterable, expandable, responsive

---

## Phase 4: User Story 2 - Token Usage & Cost (Priority: P2)

**Goal**: Aggregated usage summary with date range picker and model/session grouping

**Independent Test**: Click "Usage" tab → see totals (input tokens, output tokens, cost) and a breakdown table grouped by model → switch to "last 7 days" → totals update

### Implementation for User Story 2

- [ ] T016 [P] [US2] Create date range preset selector component (7d, 30d, custom) in apps/web/app/(authenticated)/observability/date-range-picker.tsx
- [ ] T017 [US2] Create usage summary component with SWR fetching, totals cards, and breakdown table in apps/web/app/(authenticated)/observability/usage-summary.tsx
- [ ] T018 [US2] Add groupBy toggle (model/session) and wire date range to usage API params in apps/web/app/(authenticated)/observability/usage-summary.tsx

**Checkpoint**: Usage tab shows accurate totals and breakdown; date range and grouping controls work

---

## Phase 5: User Story 3 - Session Deep-Link (Priority: P3)

**Goal**: One-click navigation from session chat view to pre-filtered observability events

**Independent Test**: Open session chat → click observability link → dashboard opens with that session's events pre-filtered

### Implementation for User Story 3

- [ ] T019 [US3] Add "View Events" link/button to session detail page that navigates to /observability?sessionId=X in apps/web/app/(authenticated)/sessions/[id]/ (appropriate component)
- [ ] T020 [US3] Ensure events-table reads initial sessionId from URL params and pre-populates the session filter in apps/web/app/(authenticated)/observability/events-table.tsx

**Checkpoint**: Deep-link from session → dashboard works; clearing filter shows all events

---

## Phase 6: User Story 4 - Sort & Filter (Priority: P3)

**Goal**: Column sorting and combined filter interactions for efficient debugging

**Independent Test**: Click Duration column → events sorted by duration → select "error" status → only errors shown → click "Clear filters" → full list restored

### Implementation for User Story 4

- [ ] T021 [US4] Add client-side column sorting (clickable headers with direction indicators) to events table in apps/web/app/(authenticated)/observability/events-table.tsx
- [ ] T022 [US4] Add "Clear filters" button that resets all filters and sort state in apps/web/app/(authenticated)/observability/filters.tsx

**Checkpoint**: Sort by any column, combine filters, clear all — all work without page reloads

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Empty states, error handling, and final quality pass

- [ ] T023 [P] Add empty state components (no events, no sessions, no usage data) using EmptyState primitive in apps/web/app/(authenticated)/observability/events-table.tsx and usage-summary.tsx
- [ ] T024 [P] Add error boundary / error state handling for failed API fetches in apps/web/app/(authenticated)/observability/page.tsx
- [ ] T025 Run full typecheck (`bun run typecheck`) and fix any type errors
- [ ] T026 Manual verification: run through quickstart.md test scenarios

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 (needs `queryEvents` method for the route)
- **Phase 3 (US1)**: Depends on Phase 2 (needs API route + page shell)
- **Phase 4 (US2)**: Depends on Phase 2 only (uses existing `/api/observability/usage` route)
- **Phase 5 (US3)**: Depends on Phase 3 (needs events table to deep-link into)
- **Phase 6 (US4)**: Depends on Phase 3 (extends events table with sort/clear)
- **Phase 7 (Polish)**: Depends on Phases 3 + 4

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational — no other story dependencies
- **US2 (P2)**: Depends on Foundational — independent of US1 (separate tab)
- **US3 (P3)**: Depends on US1 (needs events table to exist for deep-link target)
- **US4 (P3)**: Depends on US1 (extends the events table)

### Parallel Opportunities

- T004 + T005 + T006 + T008 can run in parallel (Phase 2)
- T009 + T010 can run in parallel (US1 components)
- T016 can start while T011–T015 are in progress (independent component)
- US1 and US2 implementation can run in parallel after Phase 2
- T023 + T024 can run in parallel (Polish)

---

## Parallel Example: Phase 2 (Foundational)

```bash
# All independent — different files:
Task T004: "Create events API route in apps/web/app/api/observability/events/route.ts"
Task T005: "Add gateway events route in apps/gateway/src/routes/observability.ts"
Task T006: "Add Activity icon to icon rail in apps/web/components/layout/icon-rail.tsx"
Task T008: "Create loading skeleton in apps/web/app/(authenticated)/observability/loading.tsx"
```

## Parallel Example: US1 Components

```bash
# Different files, no dependencies on each other:
Task T009: "Column definitions in apps/web/components/observability/columns.tsx"
Task T010: "Event detail component in apps/web/app/(authenticated)/observability/event-detail.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Platform queryEvents method + migration
2. Complete Phase 2: API route + nav icon + page shell
3. Complete Phase 3: Events table (US1)
4. **STOP and VALIDATE**: Table loads, pagination works, rows expand, filters apply
5. Ship: developers can now debug agent behavior

### Incremental Delivery

1. Phase 1 + 2 → Foundation ready
2. Add US1 (events table) → Test → Deploy (MVP!)
3. Add US2 (usage summary) → Test → Deploy (cost visibility)
4. Add US3 + US4 (deep-link + sort/filter polish) → Test → Deploy (full feature)
5. Phase 7: polish → Final deploy

---

## Notes

- [P] tasks = different files, no dependencies
- No test tasks generated (not explicitly requested in spec)
- TanStack Table v8 is already installed — no dependency additions needed
- The cross-session `queryEvents` method is the key new platform capability
- Responsive design handled within US1 (T015) — not a separate phase
- All filter/sort state persisted in URL (FR-009) via custom hook (T013)

# Research: Agent Observability Dashboard

**Date**: 2026-05-21 | **Branch**: `002-observability-dashboard`

## Research Topics

### 1. Cross-Session Event Querying

**Decision**: Add a `queryEvents(auth, opts)` method to `ObservabilityService` that queries `agent_events` across all sessions accessible to the user.

**Rationale**: The existing `queryBySession` requires a `sessionId` parameter. The dashboard's default view (FR-002) shows all events across sessions. Rather than calling `queryBySession` N times (N+1 pattern), a single query joining `agent_events` with `sessions` for ownership filtering is required.

**Alternatives considered**:
- Client-side aggregation of per-session queries: Rejected — violates Performance principle (N+1), doesn't support cross-session sorting/pagination.
- Materialized view: Premature optimization; the existing indexes (`agent_events_session_created_idx`, `agent_events_status_idx`) plus a join on `sessions.userId` are sufficient.

**Implementation**: Same cursor pagination pattern as `queryBySession` but with `sessions.userId = auth.userId` (or no ownership filter for admins) instead of `sessionId = X`. Add optional `sessionId` filter param for deep-link pre-filtering.

---

### 2. TanStack Table v8 Patterns for Server-Side Pagination

**Decision**: Use server-side pagination with client-side sorting/filtering within the fetched page.

**Rationale**: With potentially thousands of events, full client-side data is impractical. Cursor pagination from the API provides the dataset; TanStack Table handles column sorting, expansion, and filtering within the current page. "Load more" or infinite scroll fetches the next cursor.

**Alternatives considered**:
- Full server-side sort/filter: Would require new API params for sort direction/column, adding backend complexity. The current API already supports `type`, `status`, `after`, `before` filters server-side. Client-side sort within a page (100 rows) is O(n log n) at ~100 items — negligible.
- Virtual scrolling: Over-engineered for v1; standard pagination with "Load More" is simpler and works on mobile.

**Implementation**:
- `useReactTable` with `manualPagination: true`
- Column definitions for: trigger/user, session, type, status, duration, timestamp
- `getRowCanExpand: () => true` for inline detail
- SWR fetcher with cursor param for pagination
- URL searchParams synced for type/status/session filters (server-side) and sort column (client-side within page)

---

### 3. User/Trigger Attribution

**Decision**: Derive trigger attribution from existing `agent_events.metadata` and join with `sessions` table for user info.

**Rationale**: The `metadata` JSONB field on `agent_events` already stores `userId` and `sessionId`. Sessions have a `userId` foreign key. The triggering context (manual message vs webhook vs CI event) can be inferred from the session's creation context or the `agent_runs` table's trigger field.

**Alternatives considered**:
- Add a new `trigger` column to `agent_events`: Schema migration for a display concern; metadata already captures this. Rejected for v1.
- Show only user email: Insufficient — users want to know *why* the agent ran (user message, review job, CI webhook).

**Implementation**: Join `sessions.userId` → `users.email/name` for attribution. For trigger type, check `agent_runs.trigger` or fallback to metadata field. Display as "User Name · trigger type" in the table column.

---

### 4. URL State Management

**Decision**: Use `nuqs` or raw `useSearchParams` + `useRouter` for URL state synchronization.

**Rationale**: Spec FR-009 requires filter/sort state in URL params for shareability. The app already uses `useSearchParams` for session filters. For consistency and simplicity, continue with the native Next.js approach rather than adding a new dependency.

**Alternatives considered**:
- `nuqs` library: Clean API but adds a dependency for something achievable with native hooks. Violates Simplicity principle.
- React state only (no URL sync): Violates FR-009 (bookmarkable views).

**Implementation**: Custom `useObservabilityParams` hook that reads/writes `type`, `status`, `sessionId`, `from`, `to`, `groupBy` from URL searchParams. Replace on filter change via `router.replace`.

---

### 5. Dashboard Page Layout (Events vs Usage)

**Decision**: Use the existing `Tabs` primitive for switching between "Events" and "Usage" views within a single `/observability` page.

**Rationale**: Two separate pages (`/observability/events` and `/observability/usage`) add routing complexity for what is a single-page experience. A tabbed interface using the existing `Tabs` primitive is simpler, matches the settings page pattern, and keeps the icon rail link straightforward.

**Alternatives considered**:
- Nested routes (`/observability/events`, `/observability/usage`): More complexity, separate loading states, harder to share URL state across tabs. Rejected.
- Single scrollable page with both views: Too much content density; tabs give clear separation.

**Implementation**: Default to "Events" tab. Tab state in URL param (`?tab=events|usage`). Each tab renders its own SWR-fetched content independently.

---

### 6. Responsive Table Design

**Decision**: On mobile (<768px), hide low-priority columns (session, timestamp) and show them in the expanded row detail instead.

**Rationale**: A 6-column table doesn't fit on 375px viewports. TanStack Table supports column visibility control. The critical columns on mobile are: type badge, status badge, duration. Session and timestamp move to the expandable detail row.

**Alternatives considered**:
- Horizontal scroll: Poor UX on mobile; users miss off-screen columns.
- Card layout on mobile: Different rendering path; more code; harder to maintain parity.

**Implementation**: `useMediaQuery("(min-width: 768px)")` → set column visibility via TanStack Table's `columnVisibility` state. Hidden columns still appear in the expanded detail.

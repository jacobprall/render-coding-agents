# Implementation Plan: Agent Observability Dashboard

**Branch**: `002-observability-dashboard` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-observability-dashboard/spec.md`

## Summary

Build a read-only observability dashboard as a new top-level page (`/observability`) in the web app. The dashboard provides a cross-session event table (TanStack Table with inline expandable rows, filtering, sorting, cursor pagination) and a usage/cost summary view with date range and grouping controls. A new platform method and API route are needed to query events across all user-accessible sessions.

## Technical Context

**Language/Version**: TypeScript 5.x on Bun runtime

**Primary Dependencies**: Next.js 15 (App Router), TanStack Table ^8.21.3, SWR ^2.4.1, lucide-react, Tailwind v4 with semantic tokens

**Storage**: PostgreSQL 16 via Drizzle ORM (existing `agent_events` + `event_series` tables)

**Testing**: Bun test runner (`bun:test`)

**Target Platform**: Web (authenticated browser clients)

**Project Type**: Web application (monorepo: apps/web, packages/platform)

**Performance Goals**: 100-row table render + sort/filter in <1s; usage view loads in <5s

**Constraints**: No additional infrastructure; existing Postgres indexes must be sufficient; responsive 375px–2560px

**Scale/Scope**: Thousands of events per user; dozens of sessions; single-user or admin views

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | ✅ Pass | TanStack Table already installed; reuse existing primitives and SWR patterns; no new dependencies |
| II. Observability | ✅ Pass | Feature directly serves this principle — surfaces agent observability to users |
| III. Modularity | ✅ Pass | New platform method in existing service; new page in app; no circular deps |
| IV. API-First | ✅ Pass | New route mirrors in gateway; dashboard consumes same API as external clients |
| V. Reliability | ✅ Pass | Read-only dashboard; graceful error/empty states required by spec |
| VI. Security | ✅ Pass | Existing `requireAuth` + session ownership scoping; admin bypass |
| VII. Testing | ✅ Pass | New platform method needs tests; UI integration tested via existing patterns |
| VIII. OSS-Friendly | ✅ Pass | No new env vars required; works with existing Postgres data |
| IX. Performance | ✅ Pass | Cursor pagination prevents full table scans; TanStack Table client-side sort is O(n log n) on page |

No violations. Proceed.

## Project Structure

### Documentation (this feature)

```text
specs/002-observability-dashboard/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (via /speckit-tasks)
```

### Source Code (repository root)

```text
packages/platform/src/services/
└── observability.ts              # Add queryEvents() method (cross-session)

apps/web/
├── app/api/observability/
│   ├── events/route.ts           # NEW: GET cross-session events
│   └── usage/route.ts            # EXISTS: usage aggregation
├── app/(authenticated)/observability/
│   ├── page.tsx                  # Server page shell
│   ├── loading.tsx               # Skeleton loading state
│   ├── events-table.tsx          # Client: TanStack Table + SWR
│   ├── usage-summary.tsx         # Client: usage totals + breakdown table
│   ├── event-detail.tsx          # Inline expandable row content
│   └── filters.tsx               # Type/status/session filter controls
├── components/layout/
│   └── icon-rail.tsx             # ADD: observability icon
└── components/observability/
    └── columns.tsx               # TanStack column definitions

apps/gateway/src/routes/
└── observability.ts              # ADD: cross-session events route mirror

tests/platform/
└── observability.test.ts         # ADD: queryEvents tests
```

**Structure Decision**: All dashboard UI lives under `apps/web/app/(authenticated)/observability/` as client components within a server page shell. Platform logic stays in `packages/platform`. Gateway mirrors the new route for headless API parity.

## Complexity Tracking

No violations to justify.

# Quickstart: Observability Dashboard Development

## Prerequisites

- Local dev environment running (`bun run dev`)
- At least one agent session completed (so there's event data to display)
- Database schema up to date (`bun run db:push`)

## Development Steps

### 1. Add the cross-session events API

```bash
# New platform method
# Edit: packages/platform/src/services/observability.ts
# Add: queryEvents(auth, opts) — cross-session variant of queryBySession

# New web route
# Create: apps/web/app/api/observability/events/route.ts

# New gateway route
# Update: apps/gateway/src/routes/observability.ts
```

### 2. Add the new index (migration)

```bash
# Create migration for the cross-session query index
# File: apps/web/lib/db/migrations/0005_observability_global_index.sql
bun run db:push
```

### 3. Add the observability icon to the rail

```bash
# Edit: apps/web/components/layout/icon-rail.tsx
# Add: Activity icon from lucide-react, linking to /observability
```

### 4. Create the observability page

```bash
# Create: apps/web/app/(authenticated)/observability/page.tsx
# Create: apps/web/app/(authenticated)/observability/loading.tsx
```

### 5. Build the events table

```bash
# Create: apps/web/app/(authenticated)/observability/events-table.tsx
# Create: apps/web/components/observability/columns.tsx
# Create: apps/web/app/(authenticated)/observability/event-detail.tsx
# Create: apps/web/app/(authenticated)/observability/filters.tsx
```

### 6. Build the usage summary

```bash
# Create: apps/web/app/(authenticated)/observability/usage-summary.tsx
```

### 7. Add deep-link from session view

```bash
# Edit: apps/web/app/(authenticated)/sessions/[id]/ (add observability link)
```

## Verification

```bash
# Typecheck
bun run typecheck

# Tests
bun test tests/platform/observability.test.ts

# Manual verification
# 1. Navigate to http://localhost:4000/observability
# 2. Verify event table loads with data from previous sessions
# 3. Test filters (type, status, session)
# 4. Test inline row expansion
# 5. Switch to Usage tab, verify totals
# 6. From a session chat, click the observability link
```

## Key Files Reference

| Purpose | Path |
|---------|------|
| Platform service | `packages/platform/src/services/observability.ts` |
| Web API (events) | `apps/web/app/api/observability/events/route.ts` |
| Web API (usage) | `apps/web/app/api/observability/usage/route.ts` |
| Gateway routes | `apps/gateway/src/routes/observability.ts` |
| Icon rail | `apps/web/components/layout/icon-rail.tsx` |
| Dashboard page | `apps/web/app/(authenticated)/observability/page.tsx` |
| Table columns | `apps/web/components/observability/columns.tsx` |
| DB schema | `packages/db/schema/observability.ts` |

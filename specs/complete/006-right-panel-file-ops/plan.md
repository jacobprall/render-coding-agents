# Implementation Plan: Right Panel File Operations

**Branch**: `main` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-right-panel-file-ops/spec.md`

## Summary

Remove the hard-coded 600px max-width on the right panel, connect the existing file tree/file viewer/git panel stubs to the real sandbox APIs, implement the icon-rail + breadcrumb navigation pattern when a file is selected, and add unified inline diff expansion to the git panel's file list.

## Technical Context

**Language/Version**: TypeScript 5.x (Bun runtime)

**Primary Dependencies**: Next.js 15 (App Router), React 19, SWR, Tailwind CSS 4, Lucide icons, existing `diff-viewer.tsx` unified diff parser

**Storage**: PostgreSQL 16 (Drizzle ORM) — sessions only; file content served from sandbox

**Testing**: Vitest (unit), Playwright (integration)

**Target Platform**: Web (modern browsers)

**Project Type**: Web application (monorepo: `apps/web`)

**Performance Goals**: Directory listing <500ms, file content <1s, diff render <1s (per spec SC-001–SC-005)

**Constraints**: Panel max-width bounded only by chat area minimum (450px). No custom in-file search this iteration.

**Scale/Scope**: Single session at a time; repositories up to 1000+ files (lazy loaded)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | PASS | No new frameworks; extends existing component stubs |
| II. Observability | PASS | API routes already emit structured errors; SSE delivers file events |
| III. Modularity | PASS | All changes in `apps/web`; no package boundary violations |
| IV. API-First | PASS | File/git endpoints already defined; connecting to sandbox adapter |
| V. Reliability | PASS | Error states handled per spec FR-010; graceful degradation |
| VI. Security | PASS | All routes use `requireForgeAuth()` + `requireSessionForUser()` |
| VII. Testing | PASS | Critical paths (API routes, tree navigation) will have tests |
| VIII. OSS-Friendly | PASS | No proprietary deps; env-configurable sandbox URL |
| IX. Performance | PASS | Lazy loading, SWR caching, `content-visibility: auto` |

## Project Structure

### Documentation (this feature)

```text
specs/006-right-panel-file-ops/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
apps/web/
├── app/api/sessions/[id]/
│   ├── files/
│   │   ├── route.ts           # Directory listing (connect to sandbox)
│   │   └── content/route.ts   # File content (connect to sandbox)
│   └── git/
│       ├── status/route.ts    # Git status (connect to sandbox)
│       ├── diff/route.ts      # NEW: Per-file unified diff endpoint
│       └── commit/route.ts    # Commit action (existing)
├── components/
│   ├── layout/
│   │   ├── app-shell.tsx      # Remove RIGHT_PANEL_MAX constant
│   │   ├── right-panel.tsx    # Icon-rail + breadcrumb pattern
│   │   └── right-panel-context.tsx
│   ├── session/
│   │   ├── file-tree.tsx      # Already functional (minor tweaks)
│   │   ├── file-preview.tsx   # Already functional (breadcrumb nav)
│   │   └── git-panel.tsx      # Add expandable inline diff per file
│   └── diff-viewer.tsx        # Reuse existing unified diff renderer
├── hooks/
│   ├── use-file-tree.ts       # Already functional
│   ├── use-git-status.ts      # Extend with per-file diff data
│   └── use-panel-resize.ts    # Dynamic max-width calculation
└── lib/
    ├── sandbox-client.ts      # NEW: HTTP client for sandbox API calls
    └── file-icons.ts          # Existing
```

**Structure Decision**: All modifications within existing `apps/web` structure. One new file (`sandbox-client.ts`) abstracts sandbox HTTP calls. One new API route (`git/diff`) for per-file diff content.

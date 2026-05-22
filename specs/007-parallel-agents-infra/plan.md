# Implementation Plan: Parallel Agents Infrastructure

**Branch**: `007-parallel-agents-infra` | **Date**: 2026-05-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification + Architecture decision record (`architecture.md`)

## Summary

Extend the existing agent platform to support parallel agent sessions with sub-second workspace setup, workspace-level configuration inheritance, and structured event streaming. The architecture doc is the source of truth for approach. Key insight: much of the schema and infrastructure scaffolding already exists (workspace columns on `projects`, mirror/worktree sandbox endpoints, v2 event types). This plan focuses on completing, hardening, and wiring the existing pieces into a production-ready whole.

## Technical Context

**Language/Version**: TypeScript (Bun runtime)

**Primary Dependencies**: Next.js 15, Hono, Drizzle ORM, Redis (ioredis), Anthropic SDK

**Storage**: PostgreSQL 16 (via Drizzle), Redis Streams, Sandbox persistent disk (20GB at `/workspace/`)

**Testing**: Bun test (unit), integration tests against local Redis/Postgres

**Target Platform**: Linux server (Render Background Workers + Web Services)

**Project Type**: Monorepo (apps: web, agent, gateway, sandbox, cli; packages: db, platform, shared)

**Performance Goals**: <1s workspace setup from mirror, 10 concurrent sessions/worker, <500ms event delivery, <2s steering response

**Constraints**: No new services; extend existing agent worker, sandbox, and Redis. Backward-compatible SSE during migration.

**Scale/Scope**: 10 concurrent agent sessions per worker instance, multi-repo workspaces (2-5 repos typical)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | PASS | Extends existing infra, no new services. Mirrors are git primitives (bare clone + worktree). |
| II. Observability | PASS | Event taxonomy formalizes structured events. All operations emit progress. |
| III. Modularity | PASS | Changes stay within existing package boundaries (platform/events, sandbox/mirrors, agent/workspace). |
| IV. API-First | PASS | Sandbox exposes REST endpoints for mirrors/worktrees. Gateway streams events. |
| V. Reliability | PASS | At-least-once delivery maintained. Fallback to GitHub clone on mirror failure. Corruption auto-recovery. |
| VI. Security | PASS | Workspace isolation (SC-006). Secrets encrypted at rest. No cross-workspace access. |
| VII. Testing Discipline | PASS | Critical paths (workspace setup, event delivery, cancellation) require coverage. |
| VIII. OSS-Friendly | PASS | Env-var config. No proprietary dependencies added. |
| IX. Performance | PASS | Sub-second setup, streaming events, background workers. |

**All gates pass. No violations to justify.**

## Project Structure

### Documentation (this feature)

```text
specs/007-parallel-agents-infra/
├── architecture.md      # Source of truth for approach (existing)
├── spec.md              # Feature specification (existing)
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api.md
└── checklists/
    └── requirements.md  # Quality checklist (existing)
```

### Source Code (repository root)

```text
packages/
├── db/schema/
│   └── org.ts                    # Workspace (projects) schema — already has columns, needs completion
├── platform/src/
│   ├── events/
│   │   ├── run-stream.ts         # Event publishing — extend with full taxonomy
│   │   └── event-types.ts        # NEW: formal event type registry
│   ├── queue/
│   │   └── job-queue.ts          # Increase MAX_CONCURRENT to 10
│   ├── services/
│   │   ├── session.ts            # Workspace inheritance on session create
│   │   ├── session-agent-jobs.ts # Job payload: workspace config injection
│   │   └── workspace.ts          # NEW: workspace CRUD, secrets management
│   └── interfaces/
│       └── events.ts             # Event bus interface — extend with steering
└── shared/src/
    ├── stream-types.ts           # Extend v2 event types (planning, steering)
    └── workspace-types.ts        # Workspace config types — already exists

apps/
├── agent/src/
│   ├── worker.ts                 # MAX_CONCURRENT_RUNS → 10, workspace-aware setup
│   ├── agent.ts                  # setupWorkspace() — fetch-on-start, corruption recovery
│   ├── loop.ts                   # Steering event consumption between iterations
│   └── planner.ts               # NEW: planning phase (same loop, plan-only tools)
├── sandbox/server/
│   ├── services/
│   │   └── mirror-manager.ts     # Harden: corruption detection, 24h cron, fetch-on-start
│   └── server.ts                 # Webhook endpoint for GitHub push events
└── web/
    ├── app/api/
    │   ├── sessions/[id]/stream/ # SSE — backward compat translation layer
    │   ├── sessions/[id]/steer/  # NEW: steering endpoint (user message during execution)
    │   └── webhooks/github/      # NEW: GitHub push webhook → mirror fetch
    └── components/session/       # UI updates for planning/steering (future, out of scope)
```

**Structure Decision**: Existing monorepo structure with apps/ and packages/ boundaries. All changes extend existing modules. One new service file (`workspace.ts`), one new agent module (`planner.ts`), and several new API routes.

## Complexity Tracking

No constitution violations. No justification needed.

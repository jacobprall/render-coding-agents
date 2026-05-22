# Implementation Plan: Workspace Model, Repo Mirrors & Event Taxonomy

**Branch**: `004-workspace-mirrors-events` | **Date**: 2026-05-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-workspace-mirrors-events/spec.md`

## Summary

Evolve the agent platform with three foundational changes: (1) promote projects to workspaces owning multi-repo config, secrets, and skills; (2) maintain persistent bare clone mirrors on the sandbox disk with git worktree-based session setup; (3) formalize the Redis Streams event bus with a namespaced event taxonomy. All changes extend the existing architecture — no new services are introduced.

## Technical Context

**Language/Version**: TypeScript (strict, ES2022), Bun 1.2.14

**Primary Dependencies**: Next.js 15, React 19, Hono 4, Drizzle ORM, ioredis, Zod 4, Turborepo

**Storage**: PostgreSQL 16 via Drizzle ORM; Redis 7 (Streams + Pub/Sub)

**Testing**: Bun built-in test runner (`bun:test`); tests in `tests/` and `apps/gateway/tests/`

**Target Platform**: Linux server (Render); Docker containers for sandbox

**Project Type**: Monorepo with 5 apps (`web`, `agent`, `gateway`, `sandbox`, `cli`) and 3 packages (`db`, `platform`, `shared`)

**Performance Goals**: Session setup <3s with mirrors (down from 10-30s); 5+ concurrent agent runs

**Constraints**: 20GB persistent disk on sandbox; Redis Streams MAXLEN ~2000 per run; GitHub API rate limits

**Scale/Scope**: Multi-workspace, multi-repo; initial target: dozens of workspaces, hundreds of repos

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | PASS | Extends existing tables (`projects`) rather than adding new entities. No new services. env-var config. |
| II. Observability | PASS | Event taxonomy directly improves observability. Structured events with correlation via session/run IDs. |
| III. Modularity | PASS | Changes scoped to `packages/db` (schema), `packages/platform` (events, queue), `packages/shared` (types), `apps/agent` (clone logic), `apps/sandbox` (mirrors). No circular deps. |
| IV. API-First | PASS | Workspace config exposed via gateway API. Event taxonomy consumable by web, gateway, CLI, MCP. |
| V. Reliability | PASS | Fallback clone when mirror unavailable. LRU eviction prevents disk exhaustion. Event retention with TTL. |
| VI. Security | PASS | Org admin authorization for workspace config. Three-tier secrets with redaction. Sandbox isolation maintained. |
| VII. Testing Discipline | PASS | Mirror lifecycle, worktree creation, event emission are testable. Integration tests preferred for Redis/sandbox. |
| VIII. OSS-Friendly | PASS | No proprietary dependencies added. Mirror/worktree strategy uses standard git. |
| IX. Performance | PASS | Sub-second worktree setup. Streaming events maintained. Background worker processing unchanged. |

All gates pass. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/004-workspace-mirrors-events/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code (repository root)

```text
packages/db/schema/
├── org.ts               # MODIFY: extend projects table (workspace fields)
└── session.ts           # MODIFY: add session-level override fields

packages/shared/lib/
└── stream-types.ts      # MODIFY: replace ad-hoc event types with namespaced taxonomy

packages/platform/src/
├── events/
│   └── run-stream.ts    # MODIFY: emit structured events with new taxonomy
├── services/
│   └── workspace.ts     # NEW: workspace config resolution, secret injection
└── queue/
    └── job-queue.ts      # MODIFY: add workspace fields to job payload

apps/agent/src/
├── agent.ts             # MODIFY: replace ensureRepoCloned with worktree-based setup
├── worker.ts            # MODIFY: workspace-aware job params
└── run-persistence.ts   # MODIFY: emit events using new taxonomy

apps/sandbox/server/
├── handlers/
│   ├── mirror.ts        # NEW: bare clone mirror management endpoints
│   └── worktree.ts      # NEW: worktree create/remove endpoints
├── services/
│   ├── mirror-manager.ts # NEW: mirror lifecycle (create, sync, evict)
│   └── disk-monitor.ts  # NEW: disk usage monitoring + LRU eviction
└── lib/
    └── constants.ts     # MODIFY: add mirror paths

apps/web/
├── app/api/sessions/[id]/stream/route.ts  # MODIFY: translate event format
└── lib/db/migrations/
    └── NNNN_workspace_model.sql            # NEW: schema migration

apps/gateway/src/routes/
└── workspace.ts         # NEW: workspace config CRUD endpoints

tests/
├── platform/
│   └── workspace.test.ts    # NEW: workspace config resolution tests
├── agent/
│   └── worktree-setup.test.ts # NEW: worktree creation tests
└── packages/sandbox/
    └── mirror.test.ts       # NEW: mirror lifecycle tests
```

**Structure Decision**: Monorepo structure preserved. Changes are distributed across existing packages following the established modularity boundaries. Two new sandbox handlers (`mirror.ts`, `worktree.ts`), one new platform service (`workspace.ts`), one new gateway route (`workspace.ts`), and one new sandbox service layer (`mirror-manager.ts`, `disk-monitor.ts`).

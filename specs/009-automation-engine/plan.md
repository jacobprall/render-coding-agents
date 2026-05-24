# Implementation Plan: Automation Engine

**Branch**: `main` | **Date**: 2026-05-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-automation-engine/spec.md`

## Summary

Build the automation engine that enables users to configure trigger → prompt → tools → repos bindings that automatically spawn agent sessions. Supports cron/interval schedules, GitHub/GitLab event triggers, Slack message triggers, Linear issue triggers, and generic webhooks. Extends the existing `InboundRouter` → `InboundDispatcher` → Redis Streams pipeline with an automation entity, scheduler, event source adapters, and automation matching layer.

## Technical Context

**Language/Version**: TypeScript (Bun runtime)

**Primary Dependencies**: Hono (gateway), Next.js 15 (web), Drizzle ORM, ioredis, cron-parser (new — for cron expression validation/iteration)

**Storage**: PostgreSQL 16 (new tables: automations, automation_repos, automation_runs, integration_credentials) + Redis (schedule ZSET, dedup keys)

**Testing**: Vitest (unit + integration), existing test patterns

**Target Platform**: Linux server (Render), deployed as extensions to existing services (no new deployable units)

**Project Type**: Web service (monorepo — apps/gateway, apps/web, apps/agent, packages/platform, packages/db)

**Performance Goals**: Schedule ticks within 60s of configured time; event-triggered sessions within 10s of webhook receipt; 100+ active automations per org without drift

**Constraints**: No new deployable services for v1 (scheduler lives in agent worker); Redis ZSET for schedule state; cron minimum granularity = 1 minute

**Scale/Scope**: 100s of automations per org, 1000s of runs per day across the platform

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | PASS | Extends existing patterns (InboundRouter, Redis Streams). One new dependency (cron-parser). No new services. |
| II. Observability | PASS | All automation events flow through existing structured logging. Automation runs create standard sessions with full observability. |
| III. Modularity | PASS | New code in `packages/platform` (service + matcher + scheduler), `packages/db` (schema), `apps/gateway` (routes), `apps/web` (UI). No circular deps. |
| IV. API-First | PASS | Full REST API for automation CRUD before any UI. Gateway-consumable by CLI/MCP clients. |
| V. Reliability | PASS | Redis ZSET + atomic claim prevents double-fire. Webhook idempotency via existing `webhook_deliveries` table. Job queue durability unchanged. |
| VI. Security | PASS | Slack/Linear tokens encrypted at rest (ENCRYPTION_KEY). Webhook verification (HMAC). All endpoints require auth. |
| VII. Testing | PASS | AutomationMatcher and scheduler are pure-logic testable. Integration tests for webhook → session flow. |
| VIII. OSS-Friendly | PASS | Slack/Linear are optional integrations configured via env vars. Core scheduling works without any third-party service. |
| IX. Performance | PASS | Scheduler polling is O(log N). Matcher queries are indexed. Sessions are async via Redis Streams (no blocking). |

**Post-Phase 1 Re-check**: All gates still pass. Data model adds 4 tables (justified — automation, runs, repos, credentials are distinct concerns). No violations requiring Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/009-automation-engine/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research findings
├── data-model.md        # Entity schemas and relationships
├── quickstart.md        # Developer quickstart guide
├── contracts/
│   └── api.md           # REST API + internal interface contracts
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
packages/db/schema/
└── automation.ts                    # automations, automation_repos, automation_runs, integration_credentials

packages/platform/src/
├── services/
│   ├── automation.ts                # AutomationService (CRUD, lifecycle, template factory)
│   ├── automation-scheduler.ts      # AutomationScheduler (ZSET polling, tick emission)
│   └── automation-matcher.ts        # AutomationMatcher (event → automation matching)
├── inbound/
│   ├── types.ts                     # Extended InboundSource, InboundKind, RouteAction
│   ├── adapters.ts                  # + slackEventToInboundEvent, linearWebhookToInboundEvent
│   ├── default-routes.ts            # + automation.match catchall route
│   └── dispatcher.ts                # + create_automation_session action handler
└── container.ts                     # Wire AutomationService, Scheduler, Matcher

apps/gateway/src/routes/
├── automations.ts                   # REST API for automation CRUD
└── webhooks.ts                      # + /slack, /linear endpoints

apps/agent/src/
└── worker.ts                        # + scheduler start/stop in worker lifecycle

apps/web/app/(app)/automations/
├── page.tsx                         # Automation list page
├── [id]/page.tsx                    # Automation detail + run history
├── new/page.tsx                     # Create automation form
└── components/
    ├── automation-list.tsx           # List with status badges
    ├── automation-form.tsx           # Create/edit form with trigger config
    ├── trigger-config-editor.tsx     # Per-trigger-type config UI
    └── run-history.tsx               # Run history table
```

**Structure Decision**: All new code fits within existing app/package boundaries. No new deployable services. The `automation-scheduler` runs inside the agent worker process (same lifecycle as the job consumer loop). The automation matcher is a platform service injected into the dispatcher.

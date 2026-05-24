---
description: Current sprint state — updated automatically at sprint boundaries
globs: ["**/*"]
alwaysApply: true
---

# Sprint Context

<!-- This file is updated by the sprint-close skill at the end of each sprint. -->
<!-- It tells every agent what already exists and what the current sprint is building. -->

## Current Sprint

**Sprint:** 2 (first Marathon-driven sprint)
**Phase:** Kickoff — awaiting specification
**Status:** Inputs populated, ready for `sprint-kickoff` skill activation

## What Exists

### Platform Infrastructure (Epic 1 — Complete)
- **apps/agent**: Agent worker with tool loop, LLM calls (Anthropic/OpenAI direct fetch), observability, run persistence
- **apps/gateway**: Hono REST API + MCP Streamable HTTP endpoint (30+ tools), session CRUD, webhook ingestion
- **apps/web**: Next.js 15 dashboard — sessions list, chat UI, repo browser, settings, observability dashboard
- **apps/sandbox**: Docker-based isolated execution environment with path security
- **apps/cli**: `rca` CLI (config, chat, list, stop, pause, resume, stream)
- **packages/db**: Drizzle ORM schema — sessions, agent_runs, repos, api_keys, sync_connections, infra_specs, infra_resources
- **packages/platform**: Shared platform types and utilities
- **packages/shared**: Cross-package shared code

### Key Architectural Patterns
- `InboundRouter` + `InboundDispatcher` + `default-routes.ts` for webhook event routing (extensible for new trigger sources)
- `NotificationSink` adapter pattern (console, webhook, composite, noop implementations)
- `agentRuns.trigger` enum: `ci_failure`, `review_comment`, `pr_opened`, `pr_merged`, `workflow_run`, `deploy_failure`
- Bearer auth via `GATEWAY_API_SECRET` or per-user API keys (hashed, stored in `api_keys` table)
- Redis pub/sub for real-time event delivery
- Observability: structured event tracing with batch export

### Completed Specs (Epic 1)
- 001: Agent observability
- 002: Observability dashboard
- 003: Agent loop hardening
- 004: Workspace mirrors & events
- 005: Agent chat UI
- 006: Right panel file operations
- 007: Parallel agents infrastructure
- 008: Agent audit remediation

## Previous Sprint Summary

Epic 1 (Agent Powers) delivered core platform: agent loop, gateway API, web dashboard, CLI, sandbox, observability. Sprint 1 was pre-Marathon (manual development). Marathon harness installed post-completion.

## Active Decisions

- **Drizzle over Prisma**: chosen for performance, type safety, and lightweight runtime
- **Hono over Express**: chosen for edge compatibility, OpenAPI-first design, and minimal overhead
- **Direct fetch over AI SDK**: agent uses raw fetch against Anthropic/OpenAI APIs (not Vercel AI SDK) for full control over streaming, retries, and tool calling
- **InboundRouter pattern**: webhook dispatch is extensible — new triggers plug into existing routing layer
- **NotificationSink adapter**: notifications are pluggable — add new sinks without changing core logic

## Known Tech Debt

- `apps/agent/src/agent.ts` is ~1,100 lines — decomposition planned in spec 008 (US4)
- Shell command interpolation in agent workspace setup lacks escaping (spec 008, US5)
- `mergeToolResults()` silently drops unmatched tool_result parts (spec 008, US3)
- `flushNow()` in observability drops events on batch failure (spec 008, US2)
- Resolved skill content not actually injected into system prompt (spec 008, US1)
- Forge provider hardcodes "github" instead of reading session forge type (spec 008, US8)

## Sprint Goals

<!-- Updated at sprint kickoff by the sprint-kickoff skill -->
Sprint 2 will implement: Automation entity + schema, cron/schedule triggers, GitHub/GitLab event trigger binding, and automation builder UI scaffold.

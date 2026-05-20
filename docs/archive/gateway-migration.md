# Gateway-First Architecture Migration

> **Status: COMPLETE** — All 6 phases have been implemented.
>
> **Goal:** Make the Hono gateway the single canonical API layer. The Next.js web
> app becomes a pure rendering concern — pages, RSC data loading, and thin proxy
> routes that forward client-side requests to the gateway.

## Architecture

```
Browser
  │
  ▼
apps/web (Next.js)
  • Pages / RSC / Client Components
  • NextAuth (login, session cookie → userId)
  • Thin API proxy routes → gatewayFetch()
  • RSC pages: direct platform reads for perf (server-side only)
  │
  │  gatewayFetch (internal network, GATEWAY_API_SECRET + X-OpenForge-User-Id)
  ▼
apps/gateway (Hono)
  • ALL REST endpoints (single source of truth)
  • SSE streaming (run events, inbox, CI logs)
  • Webhooks (Forgejo, GitHub, GitLab, Render)
  • MCP server
  • OpenAPI / Swagger docs
  • Auth: Bearer API key (external) | internal secret + user impersonation
  │
  ▼
@openforge/platform
  • PlatformContainer (services, DB, Redis)
  • Domain services (sessions, repos, PRs, orgs, projects, ...)
  • Forge provider abstraction (Forgejo, GitHub, GitLab)
  • Queue (Redis Streams) + Event bus (pub/sub)
  │
  ├─► apps/agent (Worker) — Redis consumer, LLM calls, sandbox exec
  └─► @openforge/db (schema only)
```

## Principles

1. **One API, one truth** — every HTTP endpoint lives in the gateway. The web app
   never re-implements API logic.
2. **Impersonation, not duplication** — `gatewayFetch` passes
   `X-OpenForge-User-Id`; the gateway resolves user context from the header when
   the request is authenticated via the internal secret.
3. **RSC reads are OK** — server components can query the DB directly via
   platform for initial page data (no extra hop). Only client-initiated fetches
   go through the proxy.
4. **Streaming is pass-through** — SSE endpoints in the web app become HTTP
   proxies that pipe the gateway's SSE response through to the browser.
5. **Shared is for types** — `@openforge/shared` holds types, errors, logger,
   and model catalog. Implementation code lives in `@openforge/platform`.

## Implementation Summary

### Phase 1: Gateway Auth Enhancement ✅

Added user impersonation to `apps/gateway/src/middleware/auth.ts`:
`GATEWAY_API_SECRET` + `X-OpenForge-User-Id` header resolves an `AuthContext`
for the specified user (not admin fallback).

### Phase 2: `gatewayFetch` Upgrade ✅

Rewrote `apps/web/lib/gateway.ts` with:
- `gatewayFetch(path, opts)` — low-level fetch with internal auth and userId
- `gatewayProxy(req, gatewayPath, userId)` — forward NextRequest → NextResponse
- `gatewayStream(gatewayPath, userId)` — proxy SSE streams
- `requireUserId()` — resolve NextAuth session → userId

### Phase 3: Missing Gateway Routes ✅

Added to the gateway:
- `projects.ts` — full CRUD + repo associations
- `search.ts` — repository search
- `org.ts` — singular org (platform org, members)
- Render deploy webhooks in `webhooks.ts`
- Repo listing + branch listing in `sessions.ts`

### Phase 4: Web API Route Conversion ✅

Converted 57+ web API route files into thin proxy handlers. All business logic
removed; routes call `gatewayProxy()` or `gatewayStream()`. Server actions
(`sessions/actions.ts`, `pulls/actions.ts`) also converted to use `gatewayFetch`.

### Phase 5: `@openforge/shared` Cleanup ✅

Deleted from shared:
- Forge implementations: `forgejo-adapter.ts`, `factory.ts` (live in platform)
- Orphaned files: `job-queue.ts`, `run-stream.ts`, `dead-letter.ts`, `metrics.ts`,
  `tool-state.ts`, `paste-blocks.ts`, `diff.ts`, `chat-parts.ts`
- Forgejo: `client.ts`, `ci-helpers.ts`
- `api-key-resolver.ts` (moved implementation into platform)
- Removed `@openforge/db` dependency from shared

Kept in shared: `errors.ts`, `api-types.ts`, `request-id.ts`, `logger.ts`,
`model-catalog.ts`, `stream-types.ts`, `ci/test-results.ts`, `encryption.ts`,
`llm-key-validation.ts`, `forgejo/webhook-signature.ts`, forge types/interfaces.

### Phase 6: Dead Code Removal ✅

Deleted 20+ orphaned files from `apps/web/lib/`:
- `sessions/enqueue-message.ts`, `sessions/auto-title.ts`
- `agent/enqueue-session-job.ts`, `agent/escalation.ts`
- `ci/result-handler.ts`, `ci/dispatcher.ts`, `ci/local-runner.ts`,
  `ci/ci-result-schema.ts`, `ci/workflow-parser.ts`
- `skills/resolve-for-session.ts`
- `sse/shared-subscriber.ts`, `sse/connection-pool.ts`
- `sync/mirror-engine.ts`
- `invites/create-invite.ts`
- `orgs/org-service.ts`, `orgs/permissions.ts`, `orgs/quotas.ts`
- `models/anthropic-models.ts`
- `api/client.ts`, `api/handler.ts`, `api/index.ts`, `api/types.ts`,
  `api/pagination.ts`

Simplified `instrumentation.ts` (removed mirror cron).

## What Stays in Web

These remain in `apps/web` because they're browser-specific:

- `GET/POST /api/auth/[...nextauth]` — NextAuth session management
- `POST /api/auth/invite/accept` — browser flow (uses platform directly)
- `GET /api/oauth/github` + `/callback` — OAuth redirect flow
- `GET /api/oauth/gitlab` + `/callback` — OAuth redirect flow
- `GET /api/sync/[provider]/repos` — sync connection repos (uses web-specific OAuth helpers)
- `GET /api/metrics` — observability endpoint
- `GET /api/health` — health check

## Impact

- **Net code reduction:** ~7,300 lines removed across all phases
- **Eliminated duplication:** Business logic exists in one place (gateway + platform)
- **Cleaner shared package:** No more implementation code; only types, errors, and utilities
- **Clear layering:** Browser → Web (proxy) → Gateway (API) → Platform (logic)

# Gateway Consolidation

Eliminate the proxy hop between the Next.js web app and the gateway for
browser-originated requests while keeping the gateway alive for its unique
audiences (MCP clients, CLI/CI consumers, external webhooks).

## Problem

Almost every web API route (`apps/web/app/api/`) is a thin proxy that calls
`gatewayProxy(req, path, userId)`. The request path looks like:

```
Browser → Next.js API route → HTTP → Gateway → PlatformContainer → DB/Redis
```

The web app already has its own `PlatformContainer` singleton
(`apps/web/lib/platform.ts`) backed by the same database and Redis. The
extra hop adds latency, duplicates error handling, and doubles the failure
surface for every UI-initiated call.

## Target state

```
Browser → Next.js API route → PlatformContainer → DB/Redis   (direct)
MCP / CLI / CI → Gateway → PlatformContainer → DB/Redis      (unchanged)
```

The gateway stays as a standalone service for:

- **MCP endpoint** (`/mcp`) — stateful Streamable HTTP transport that needs a
  long-lived process.
- **Headless REST API** — bearer-token auth for CLI tools, CI pipelines, and
  custom integrations.
- **Webhook ingestion** — lightweight always-on receiver for Forgejo, GitHub,
  and GitLab events.

## Phases

### Phase 1 — Direct platform calls in web routes

Convert the ~25 proxy routes in `apps/web/app/api/` to call platform services
directly instead of forwarding to the gateway.

1. Identify every route that uses `gatewayProxy`, `createGatewayHandler`, or
   `createGatewayStreamHandler`.
2. For each route, replace the proxy call with a direct call to the
   appropriate platform service via `getPlatform()` + `requireForgeAuth()` /
   `requireAuth()`.
3. Use the existing gateway route handlers (`apps/gateway/src/routes/`) as a
   reference for request parsing, validation, and response shaping — the
   platform calls are already written there.
4. Delete `apps/web/lib/gateway.ts` once no routes import it.

**Already done (examples to follow):**
- `GET /api/sessions` — queries the DB directly.
- `GET /api/sessions/repos` — fetches repos via platform forge provider, falls
  back to gateway.
- Invite routes — use `requireAuth()` + platform directly.

### Phase 2 — Consolidate webhook routes

Both the web app and gateway have webhook handlers for GitHub and GitLab.
Decide on a single ingestion point per provider:

- If the gateway is the canonical receiver, remove the web app duplicates and
  have the forge provider deliver webhooks to the gateway URL.
- If the web app should own it (simpler for providers that already point
  there), move the handler logic from the gateway into the web app.

Forgejo webhooks stay on the gateway (the gateway owns the Forgejo
relationship).

### Phase 3 — SSE streaming without the gateway hop

The web app currently proxies SSE streams via `gatewayStream()`. Replace with
direct Redis pub/sub subscriptions in the Next.js API routes using the shared
Redis client.

The gateway's `apps/gateway/src/routes/stream.ts` shows the subscription
pattern — replicate it using `getSharedRedisClient()` from
`apps/web/lib/redis.ts`.

### Phase 4 — Remove web → gateway env wiring

Once no web routes proxy to the gateway:

1. Drop `GATEWAY_INTERNAL_URL` and `GATEWAY_API_SECRET` from the web
   service's env vars in `render.yaml`.
2. Remove the `fromService` reference that links the web service to the
   gateway's secret.
3. The gateway keeps its own `GATEWAY_API_SECRET` for external consumers.

### Phase 5 — Right-size the gateway

With UI traffic removed, the gateway handles only MCP, CLI, and webhook
traffic. Evaluate whether it can move to a smaller Render plan or be
collapsed into a worker process alongside the agent.

## What NOT to change

- The gateway's MCP server (`/mcp`) stays as-is. MCP's stateful transport
  needs a long-lived Hono process.
- The gateway's REST API contract stays as-is. External consumers (CLI, CI,
  Cursor/Claude Desktop) should not be affected.
- The `@coding-agents/platform` package remains the shared business logic
  layer used by both the web app and the gateway.

## Risks

| Risk | Mitigation |
|---|---|
| Breaking API behavior during migration | Migrate one route at a time; compare response shapes against the gateway handler |
| SSE streaming differences | Test with the chat UI end-to-end after Phase 3 |
| Webhook double-delivery during transition | Coordinate provider webhook URL changes with route removal |
| Gateway downscaling breaks MCP clients | Monitor MCP usage before changing the plan |

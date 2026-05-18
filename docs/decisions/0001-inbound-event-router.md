# ADR-0001: Inbound event router layer

**Status:** Accepted  
**Date:** 2026-05-17

## Context

External signals arrive through three unrelated surface areas:

- Forgejo webhooks (`/api/webhooks/forgejo`)
- GitHub webhooks (`/api/webhooks/github`)
- GitLab webhooks (`/api/webhooks/gitlab`)
- Render deploy callbacks (`/api/webhooks/render`)
- CI result callbacks (`/api/ci/results`)

Each endpoint contained its own parsing, routing, and trigger logic. This made it hard to:
- Add a new trigger source without editing multiple files
- Observe which events are received versus ignored
- Test routing logic in isolation (it was tangled with HTTP context)
- Cancel superseded runs when a PR receives new commits (coalescing)

## Decision

Introduce a canonical `InboundEvent` type and an `InboundRouter` / `InboundDispatcher` layer in `packages/platform/src/inbound/`.

Every external signal is first **parsed by an adapter** into an `InboundEvent`:

```typescript
interface InboundEvent {
  id: string;          // delivery ID for idempotency
  source: InboundSource;
  kind: InboundKind;   // review_comment | pr_opened | pr_synchronize | ci_failure | …
  actor?, repo?, pr?;  // canonical fields
  payload;             // raw body for downstream handlers
  receivedAt: Date;
}
```

The **`InboundRouter`** evaluates a first-match-wins route table and returns a `RouteAction` — a pure data value with no side effects. The **`InboundDispatcher`** executes the action.

Route actions:
- `trigger_session` — enqueue a CI/review trigger for matched sessions
- `create_diagnostic_session` — create a new session from a deploy failure
- `coalesce` — cancel stale runs for a PR before triggering
- `ignore` — no-op (logged for observability)

The existing per-provider webhook handlers are **not removed**. They still run for their provider-specific side effects (updating `prNumber`, inserting `ci_events`/`pr_events` rows, auto-merge). The router layer wraps them for routing decisions.

## Consequences

**Good:**
- `InboundRouter.evaluate` is a pure function — easily unit-tested without HTTP context
- Every event is logged with `inbound.received` / `inbound.routed` / `inbound.ignored` for traceability
- PR synchronize coalescing works across all three providers using the same code path
- Adding a new source requires only a new adapter + route rule, no changes to existing handlers

**Trade-off:**
- Some events trigger both the dispatcher and the legacy handler. This is intentional — the dispatcher handles routing; the legacy handler handles side effects. The duplication is visible and documented.

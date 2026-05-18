# ADR-0003: Webhook hardening

**Status:** Accepted  
**Date:** 2026-05-17

## Context

Three issues were identified in the webhook handling stack:

### 1. Dead-letter retry pushed to wrong queue

`retryDeadLetterJob` in `packages/platform/src/queue/dead-letter.ts` re-enqueued jobs via:

```typescript
await redis.rpush("agent:jobs", JSON.stringify(parsed.job));
```

The agent consumer uses **Redis Streams** (`agent:jobs:stream` via `XREADGROUP`), not a plain list. Jobs retried from the dead-letter queue were pushed to a key that no consumer ever reads. They were silently dropped.

### 2. GitHub webhook fails when secret is unconfigured

`GitHubWebhookHandler.handleGithubWebhook` threw `ValidationError("GITHUB_WEBHOOK_SECRET not configured")` when `GITHUB_WEBHOOK_SECRET` was absent. This made GitHub webhooks completely non-functional in any deployment that hadn't configured the secret (local dev, open deployments). Forgejo handles this gracefully with `shouldAllowUnsignedForgejoWebhooks()`.

### 3. No idempotency for replay / retry

GitHub, GitLab, and Forgejo all retry webhook deliveries on `5xx` responses. Without delivery tracking, a transient error followed by a retry would process the same event twice and potentially enqueue duplicate agent runs.

## Decision

**Fix 1 — Dead-letter re-enqueue:**  
Replace `rpush("agent:jobs", ...)` with `xadd(AGENT_JOBS_STREAM, "*", "payload", ...)` using the canonical stream key exported from `job-queue.ts`.

**Fix 2 — GitHub secret optional:**  
When `GITHUB_WEBHOOK_SECRET` is not set, log a warning and allow the webhook (no error). When it is set, enforce HMAC-SHA256 as before.

**Fix 3 — Delivery idempotency:**  
Add a `webhook_deliveries` table:

```sql
CREATE TABLE webhook_deliveries (
  id         text PRIMARY KEY,   -- provider delivery ID
  source     text NOT NULL,
  kind       text NOT NULL,
  processed  boolean DEFAULT false,
  received_at timestamptz DEFAULT now()
);
```

Gateway webhook routes check this table before processing. Duplicate deliveries return `{ ok: true, duplicate: true }` without re-executing business logic. Delivery IDs are recorded after successful processing.

## Consequences

**Good:**
- Dead-lettered jobs can now actually be retried
- GitHub webhooks work out of the box without secrets (safe for local dev, open source deployments)
- Webhook replays are harmless

**Trade-off:**
- The idempotency check adds one DB read per webhook delivery. This is acceptable; webhook volume is low and the read is on a primary key.
- Delivery IDs from providers that don't include a delivery header (some Render webhook versions) fall back to a UUID and receive no idempotency protection.

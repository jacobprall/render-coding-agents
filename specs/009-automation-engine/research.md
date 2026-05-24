# Research: Automation Engine

## R1: Cron Scheduling Strategy

**Decision**: Redis Sorted Set (ZSET) + polling loop in the existing agent worker process.

**Rationale**: The agent worker already runs a continuous loop pulling jobs from Redis Streams. Adding a ZSET poll (`ZRANGEBYSCORE`) every 30 seconds is trivial, requires no new infrastructure, and leverages the existing Redis connection. The ZSET gives O(log N) insertion and O(log N + M) range queries — more than sufficient for hundreds of scheduled automations.

**Alternatives considered**:
- **Render Cron Job** (separate service): Clean separation but adds deployment surface, requires DB/Redis access, minimum 1-minute granularity, and can't easily fire sub-minute schedules. Rejected for v1 — acceptable as a future optimization.
- **BullMQ repeatable jobs**: Strong feature set (delayed, repeatable, cron) but adds a significant dependency to the stack. The constitution mandates preferring standard library primitives. Redis ZSET + our own loop achieves the same with ~50 lines of code.
- **pg_cron (Postgres extension)**: Tight DB coupling, limited to minute granularity, harder to distribute across workers. Rejected.

**Implementation notes**:
- Key: `automation:schedule` (ZSET, score = Unix timestamp of nextRunAt)
- Worker polls every 30s: `ZRANGEBYSCORE automation:schedule -inf <now>`
- On match: atomically remove from ZSET, compute next occurrence, re-insert
- Use `WATCH`/`MULTI` or Lua script for atomic claim to prevent double-fire across multiple workers
- Cron parsing: `cron-parser` npm package (MIT, mature, supports timezones)

---

## R2: Event Source Adapter Pattern

**Decision**: Each new trigger source implements an adapter function `xxxToInboundEvent()` that normalizes the raw webhook payload into the canonical `InboundEvent` shape, following the existing `githubWebhookToInboundEvent()` pattern.

**Rationale**: The existing adapter pattern is proven, tested, and keeps the router source-agnostic. New sources plug in with zero changes to routing/dispatch logic.

**Alternatives considered**:
- **Generic webhook-to-event transformer** (configurable via JSON schema): More flexible but over-engineered for 3-4 known sources. Revisit when user-defined webhook triggers are needed.
- **Separate router per source**: Duplicates routing logic, violates DRY, makes cross-source coalescing impossible.

**Adapters needed**:
1. `slackEventToInboundEvent(body, headers)` — Slack Events API payload → InboundEvent
2. `linearWebhookToInboundEvent(body, headers)` — Linear webhook payload → InboundEvent
3. `scheduleTickToInboundEvent(automation)` — Internal scheduler tick → InboundEvent

---

## R3: Automation Matching Strategy

**Decision**: A single "automation catchall" route appended to `DEFAULT_ROUTES` that delegates to an `AutomationMatcher` service. The matcher queries the `automations` table for enabled automations whose trigger config matches the incoming event.

**Rationale**: Keeps the `InboundRouter` simple and stateless (no DB queries in the router itself). The catchall route runs last, so existing hardcoded routes (coalescing, PR sync) take precedence — no regression risk. The matcher can be optimized later (in-memory cache, Redis lookup) without touching the router.

**Alternatives considered**:
- **Dynamic route injection** (load routes from DB on startup): Requires router reload on automation CRUD, stale routes between reloads, complicates testing.
- **Separate AutomationDispatcher** (parallel pipeline): Two dispatch paths to reason about, duplicate logging/tracing, harder to implement cross-source coalescing.

**Matching algorithm**:
1. Filter automations by `enabled = true` and `triggerType` matching event source
2. For each candidate, evaluate `triggerConfig` against event properties:
   - GitHub: match `event kind`, optional branch filter, optional workflow filter
   - Slack: match channel ID, optional keyword/mention filter
   - Linear: match event type (assignment, label, status), optional label filter
3. Return all matches (multiple automations can fire from one event)

---

## R4: Slack Integration Pattern

**Decision**: Slack Events API with OAuth 2.0 for workspace installation. The gateway receives Slack events at `/api/webhooks/slack`, verifies the signing secret, and passes to the adapter.

**Rationale**: Events API is Slack's recommended approach for real-time event delivery. OAuth 2.0 allows multi-workspace support. Socket Mode was considered but requires a persistent WebSocket connection per workspace — undesirable for a stateless HTTP service.

**Implementation notes**:
- Required Slack scopes: `chat:write`, `channels:history`, `app_mentions:read`
- Event subscription: `message.channels`, `app_mention`
- Verification: Slack signing secret (timestamp + body + HMAC-SHA256)
- OAuth flow managed from the web app (similar to GitHub OAuth)
- Store bot token per workspace in `integrations` table (encrypted)

---

## R5: Linear Integration Pattern

**Decision**: Linear Webhooks (generic HTTP POST) with HMAC verification. Simpler than Slack — no OAuth flow required for webhook delivery (only for bidirectional status updates).

**Rationale**: Linear's webhook system is straightforward: configure a webhook URL in Linear settings, receive JSON payloads. HMAC signing secret ensures authenticity.

**Implementation notes**:
- Linear webhook events: `Issue.create`, `Issue.update`, `Comment.create`
- Verification: `x-linear-signature` header (HMAC-SHA256)
- For bidirectional sync (updating issue status from agent): Linear API key stored encrypted per org
- Gateway endpoint: `/api/webhooks/linear`

---

## R6: Coalescing and Deduplication

**Decision**: Reuse the existing `CoalesceAction` pattern for automation-triggered events. For rapid-fire events targeting the same automation + repo + PR, cancel stale runs before creating new ones.

**Rationale**: The existing `pr_synchronize.coalesce` route already implements this pattern. Automation coalescing follows the same logic: if an automation was already triggered for the same PR/branch within a deduplication window, cancel the old run.

**Implementation notes**:
- Deduplication key: `automation_id:repo:pr_number` or `automation_id:repo:branch`
- Window: last 60 seconds (configurable per automation)
- Redis key with TTL for tracking recent triggers

---

## R7: BugBot Design

**Decision**: BugBot is a pre-configured automation template (not a special system entity). It's a regular automation with trigger type `github_event`, condition `pr_opened || pr_synchronize`, and a review-focused prompt. One-click setup creates the automation with sensible defaults.

**Rationale**: Making BugBot a regular automation means it benefits from all automation infrastructure (pause, edit, run history, coalescing) without special-case code. The "template" is just a factory function that pre-fills the automation creation form.

**Implementation notes**:
- Default prompt: "Review this PR for bugs, security issues, and performance problems. Post findings as inline review comments. If configured, suggest fixes."
- Default tools: code review, PR comment posting
- Configuration: reads `.cursor/BUGBOT.md` from the repo for custom rules
- Autofix: optional follow-up automation that triggers on BugBot's own review comments

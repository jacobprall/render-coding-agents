# Clarifications: Sprint 2 — Automations Foundation

**Spec**: `.marathon/sprints/002/spec.md`
**Date**: 2026-05-24
**Inputs**: spec.md, product.md, constraints.md, existing codebase

---

## Ambiguities Identified & Resolved

### C1: Router Architecture — First-Match vs. Multi-Match

**Ambiguity**: The spec originally said automation routes run "after all legacy routes" as a catch-all, but the InboundRouter uses first-match-wins semantics. How should automations integrate with the existing dispatch system?

**Resolution**: **No backward compatibility constraint.** Refactor InboundRouter to multi-match (evaluate-all) semantics. The router evaluates every route (static + dynamic automation-backed) and returns an array of all matching actions. The dispatcher executes each action. This unifies the system:

- Static routes (existing `DEFAULT_ROUTES`) continue to work but are no longer first-match-wins exclusive
- Dynamic automation routes query the DB for enabled automations matching the event's repo + kind
- Both static and automation routes can fire on the same event

The InboundRouter becomes the single dispatch orchestrator for all inbound events, whether they target existing sessions or create new automation sessions.

---

### C2: Scheduler Concurrency — Single Instance vs. Distributed

**Ambiguity**: The spec says "polling worker on a 30-second interval, backed by a Redis-based lock." But the gateway may run N instances on Render. How exactly is at-most-once guaranteed?

**Resolution**: The scheduler runs as a background interval inside the gateway process. It uses a Redis `SET NX EX` lock (`automation:scheduler:lock`, 25s TTL) before polling. Only the instance that acquires the lock runs the poll. The lock TTL (25s) is shorter than the poll interval (30s) to handle lock holder crashes.

Additionally, each due automation is claimed atomically: `UPDATE automations SET next_run_at = <next>, last_run_at = NOW() WHERE id = ? AND next_run_at = <expected>`. The WHERE clause ensures only one instance processes each due automation even if the lock is somehow bypassed.

---

### C3: `create_automation_session` — Dispatch Path

**Ambiguity**: The spec introduces automation session creation. How does it integrate with the refactored multi-match InboundRouter?

**Resolution**: The refactored InboundRouter returns an array of `RouteAction[]`. A new action type `create_automation_session` is added to the `RouteAction` union, carrying the `automationId` and trigger context. The InboundDispatcher handles this new action type by calling `SessionService.createFromAutomation(automationId, triggerContext)`.

This keeps the clean router → dispatcher → service layering. The router decides what to do (including automation matches), the dispatcher executes, and SessionService owns session creation logic.

---

### C4: Automation Entity Ownership — User vs. Project vs. Org

**Ambiguity**: The spec says "Owned by a user, scoped to a project/org" but doesn't clarify the access model. Can other org members see/edit automations created by a colleague?

**Resolution**: Automations are owned by a `userId` (creator) and optionally scoped to a `projectId`. Access rules:
- If `projectId` is set → all org members with project access can view; only owner can edit/delete
- If `projectId` is null → only the owner can view/edit/delete (personal automation)
- Sprint 2 implements owner-only access. Project-scoped access control deferred to Sprint 3 when roles/permissions become relevant.

---

### C5: Automation → Session Link — Foreign Key vs. Join Table

**Ambiguity**: The spec says "Sessions get an optional `automationId` foreign key" AND "link is through `automation_runs` join table." These are contradictory.

**Resolution**: Use **both**, serving different purposes:
- `sessions.automationId` (nullable FK) → quick lookup: "was this session created by an automation?" Enables filtering in the sessions list.
- `automation_runs` table → rich audit trail: triggered_at, trigger_event_id (webhook delivery ID), trigger_payload snapshot, outcome. Enables the run history view on the automation detail page.

The FK is the foreign key from session → automation. The join table is the audit log with additional metadata. They are complementary, not redundant.

---

### C6: Webhook Handler Dispatch — Sync vs. Async

**Ambiguity**: The current webhook handler (`webhookRoutes.post("/github", ...)`) runs `inboundDispatcher.dispatch()` synchronously before returning 200. Should automation matching also be synchronous?

**Resolution**: Automation matching is **asynchronous** (fire-and-forget after returning 200 to GitHub). Rationale:
- GitHub expects webhook responses within 10 seconds
- Automation matching requires a database query (SELECT automations WHERE repo = X AND enabled = true)
- Session creation enqueues a Redis Streams job (fast) but we don't want to risk timeout
- Pattern: `void automationMatcher.evaluateAndDispatch(event)` — non-blocking

The webhook handler returns 200 immediately. Any failures in automation dispatch are logged and retried via the scheduler's "missed execution" recovery (if a session was expected but not created).

---

### C7: Cron Library Selection

**Ambiguity**: The spec doesn't specify which cron parser library to use. The dependency policy requires >1000 GitHub stars and active maintenance.

**Resolution**: Use `cron-parser` (npm: `cron-parser`, 1.6k+ stars, actively maintained, MIT license). It provides:
- Cron expression validation
- Next execution time calculation
- Timezone-aware parsing
- Standard 5-field cron (minute, hour, day-of-month, month, day-of-week)

**Alternative considered**: `croner` (newer, TypeScript-first, similar stars). Rejected because `cron-parser` has a larger install base in production systems and better documentation for edge cases.

**Alternative considered**: Writing a custom parser. Rejected — cron parsing has well-known edge cases (leap years, DST transitions, day-of-week vs. day-of-month interaction) that are not worth reimplementing.

---

### C8: Builder UI — Multi-Step Wizard vs. Single-Page Form

**Ambiguity**: The spec describes a multi-step wizard (6 steps). Is this the right UX pattern given the product principle "data density over chrome"?

**Resolution**: Use a **single-page form with collapsible sections**, not a multi-step wizard. Rationale:
- Product principles: "data density over chrome", "keyboard-first"
- A wizard hides information and requires N clicks to reach step N
- The automation config has ~5 fields total in Sprint 2 (trigger type, cron/events, prompt, repo, name) — this fits on one page
- Collapsible sections allow progressive disclosure without pagination

The builder is a single page at `/automations/new` with sections: (1) Name + Trigger Type, (2) Trigger Configuration (contextual — shows cron or event config), (3) Prompt, (4) Repo selection. All visible, all keyboard-navigable.

**Impact on spec**: Clarification Q4 answer is revised. The "multi-step wizard" is replaced with a single-page form.

---

### C9: `agentRuns.trigger` Enum — Extend or Separate Field

**Ambiguity**: The existing `agentRuns.trigger` enum has values like `ci_failure`, `review_comment`, `pr_opened`. Should automation-triggered runs add `automation_schedule` and `automation_event` to this enum?

**Resolution**: Add two new enum values to `agentRuns.trigger`:
- `automation_schedule` — run was triggered by a cron automation
- `automation_event` — run was triggered by a GitHub event automation

This keeps the trigger source visible in existing observability queries without requiring a schema migration to add a separate field. The `sessions.automationId` FK provides the link to the specific automation config.

---

### C10: Filter Conditions — Static Configuration vs. Dynamic Expressions

**Ambiguity**: FR-010 lists filter conditions (base branch, head branch, actor, file paths, labels). How are these stored and evaluated?

**Resolution**: Filters are stored as a JSON array on the automation's `triggerConfig`:

```typescript
type FilterCondition = {
  field: "base_branch" | "head_branch" | "actor" | "label";
  operator: "equals" | "not_equals" | "contains" | "matches";
  value: string;
};
```

Evaluation: all conditions must match (AND semantics). No OR groups in Sprint 2 — users create multiple automations if they need OR logic.

**Deferred**: `file_paths_changed` filter requires diffstat from GitHub API (extra HTTP call per webhook). Deferred to Sprint 3 — Sprint 2 supports branch, actor, and label filters only.

---

## Gaps Identified

### G1: Missing — Automation Execution Timeout

The spec does not address what happens when an automation-spawned session hangs. Standard sessions have user oversight; automated sessions do not.

**Resolution**: Add `maxDurationMinutes` field to the automation entity (default: 60, max: 480). The scheduler checks active automation sessions and cancels any that exceed their timeout. This is implemented as part of the scheduler's polling loop.

---

### G2: Missing — Rate Limiting for Event Automations

If a repository receives 100 rapid-fire `pr_synchronize` events (rebasing), the system could spawn 100 sessions. The spec's coalesce logic only applies to legacy routes.

**Resolution**: Add `cooldownSeconds` field to event-type automations (default: 60). After an automation fires, it will not fire again for the same repo until the cooldown expires. Stored as `lastFiredAt` on the automation. The automation matcher checks `NOW() - lastFiredAt > cooldownSeconds` before dispatching.

---

### G3: Missing — Error State for Automations

The spec has enabled/paused states but no error state. What if an automation fails 5 times in a row?

**Resolution**: Add `status` enum: `active`, `paused`, `error`. If an automation produces 3 consecutive failed sessions (configurable via `maxConsecutiveFailures`, default 3), it transitions to `error` status and stops firing. The user sees the error in the list UI and can manually re-enable after investigating.

---

### G4: Missing — Automation Creation via API Without UI

The spec's FR-011 mentions a REST API, but no detail on the endpoint paths or Zod schemas. The gateway API pattern requires Zod-OpenAPI.

**Resolution**: Endpoints follow existing gateway conventions:
- `POST /api/automations` — create
- `GET /api/automations` — list (paginated)
- `GET /api/automations/:id` — detail (includes recent runs)
- `PATCH /api/automations/:id` — update
- `DELETE /api/automations/:id` — delete
- `POST /api/automations/:id/toggle` — enable/disable

All use Zod-OpenAPI schemas consistent with the gateway's existing patterns.

---

## Contradictions Found

### X1: InboundRouter Catch-All vs. Backward Compatibility

The spec originally assumed backward compatibility with InboundRouter's first-match-wins semantics. **This constraint has been removed.** The router will be refactored to multi-match (evaluate-all). No contradiction remains.

---

### X2: AutomationRun Join Table vs. Session FK

Addressed in C5 above. The spec contained both "optional FK on sessions" and "join table for linking." Both are kept — they serve different purposes.

---

## Alternative Implementations Evaluated

### Alt-1: Scheduler Architecture

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **A) Polling worker inside gateway** | No new service, reuses existing infra, simple deployment | Ties scheduling to gateway lifecycle, polls even when no automations exist | **Selected** |
| B) Dedicated Render cron job | Clean separation of concerns, Render-native, no polling waste | New service to deploy/maintain, cold start latency (up to 60s), harder to share DB/Redis connections | Rejected |
| C) Redis-based delayed queue (ZADD + ZPOPMIN) | Precise timing, no polling interval, event-driven | Complex implementation, requires custom consumer, harder to debug, no standard tooling | Rejected |
| D) pg_cron (PostgreSQL extension) | No application code for scheduling, highly reliable | Render PostgreSQL may not support pg_cron, couples scheduling to DB, limited observability | Rejected |

**Rationale for A**: The gateway already runs persistently, has Redis and DB connections, and the polling overhead (one SELECT every 30s) is negligible. Constitution principle IX (Performance) says "Agent work MUST be processed via background workers" — the scheduler enqueues to Redis Streams, it doesn't execute sessions itself.

---

### Alt-2: Automation Matching Architecture

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **A) Refactor InboundRouter to multi-match with integrated automation lookup** | Single unified dispatch path, DRY, clean architecture | Breaks existing first-match-wins contract (acceptable — no backward compat required) | **Selected** |
| B) Separate AutomationMatcher component (two-pass dispatch) | No changes to InboundRouter, separation of concerns | Two code paths for webhook handling, harder to reason about ordering, slight duplication | Rejected |
| C) InboundRoute per automation (dynamic route table) | Leverages existing pattern | Route table grows with automation count (N routes for N automations), DB query on every route table rebuild, hot-reload complexity | Rejected |
| D) Webhook fan-out via Redis pub/sub | Fully decoupled, async by design | Over-engineered for Sprint 2 scope, adds Redis topic management, harder to trace delivery | Rejected |

**Rationale for A**: Without backward compatibility constraints, refactoring InboundRouter to evaluate-all is the cleanest design. It unifies static routes and dynamic automation matching into a single dispatch orchestrator, eliminating the two-pass complexity of a separate matcher. The router becomes the single source of truth for "what happens when an event arrives."

---

### Alt-3: Automation Entity Storage

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **A) Dedicated `automations` table in PostgreSQL** | Type-safe with Drizzle, queryable, indexable, consistent with existing schema | Another migration, another table to manage | **Selected** |
| B) JSONB document in a generic `configs` table | Flexible schema, no migration for new fields | Loses type safety, can't index trigger conditions, query patterns are clumsy | Rejected |
| C) Redis-backed config (for fast scheduler access) | Sub-millisecond reads for scheduler | Not durable (Redis is ephemeral by design in this stack), requires sync layer with PG | Rejected |

**Rationale for A**: Constitution principles require Drizzle ORM for all database access, typed schemas, and proper indexing. The automation entity has well-defined fields that benefit from relational constraints (FK to users, projects).

---

### Alt-4: Builder UI Pattern

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **A) Single-page form with collapsible sections** | Data-dense, keyboard-navigable, fast to complete, all context visible | Longer initial page, may overwhelm new users | **Selected** |
| B) Multi-step wizard (originally specified) | Guided, approachable for new users | Hides information, more clicks, violates "data density" principle | Rejected |
| C) Conversational/chat-based builder | Novel, AI-native feel | Hard to edit after creation, no random-access to fields, slow for power users | Rejected |
| D) YAML/JSON config editor | Maximum flexibility, power-user friendly | Terrible UX for non-technical users, error-prone | Rejected |

**Rationale for A**: Product principles explicitly state "data density over chrome" and "keyboard-first." The automation config has ≤6 fields in Sprint 2 — easily fits on one page. Collapsible sections provide progressive disclosure without hiding information.

---

### Alt-5: Session-Automation Linkage

| Approach | Pros | Cons | Decision |
|----------|------|------|----------|
| **A) FK on sessions + separate audit table** | Fast filtering (FK), rich history (audit table), separation of concerns | Two places to maintain, slight redundancy | **Selected** |
| B) Only FK on sessions, query sessions for history | Simpler schema, single source of truth | Loses trigger metadata (webhook ID, payload), can't distinguish "automation created session" from "session later linked to automation" | Rejected |
| C) Only join table, no FK | Clean normalized design | Requires JOIN for basic "is this session automated?" check, slower list queries | Rejected |

---

## Unstated Assumptions Made Explicit

1. **No multi-tenancy isolation in Sprint 2**: Automations query by userId — there is no workspace/org-level isolation beyond the owner check. Multi-tenant isolation is a Sprint 3+ concern.
2. **Cron expressions are 5-field standard**: No seconds field, no year field. This is the overwhelmingly common format and what `cron-parser` supports by default.
3. **Tool configuration is stored as a JSON array of tool slugs**: The automation stores which tools are available, but does not configure per-tool parameters. Tool params use defaults.
4. **The gateway webhook endpoint is the only entry point for GitHub events**: There is no separate event bus consumer that could process events. All automation matching happens in the webhook request lifecycle (async, after 200 response).
5. **No approval gate for automation-created sessions**: Automated sessions execute immediately without user confirmation. This matches the "run unattended" requirement in R1.

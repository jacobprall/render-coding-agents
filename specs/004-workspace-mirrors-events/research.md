# Research: Workspace Model, Repo Mirrors & Event Taxonomy

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## 1. Git Worktree Concurrency

### Decision: Use file-based locking with retry for concurrent worktree operations

### Rationale

Git worktrees use a lock file (`.git/worktrees/<name>/locked`) internally. Multiple `git worktree add` commands against the same bare clone can run concurrently — git's internal locking serializes access to shared data structures (refs, HEAD). However, there are edge cases:

- **Branch creation race**: Two concurrent `worktree add -b <branch>` calls creating the same branch name will conflict. Avoided by using session-unique branch names (`agent/{sessionId}`).
- **Fetch during worktree add**: A `git fetch` running on the bare clone while a `worktree add` is in progress is safe — git's lock protocol handles this. The worktree may see the pre-fetch or post-fetch state depending on timing, which is acceptable.
- **Performance**: No known hard limits on worktree count. Performance degrades slightly with very large numbers (hundreds) due to ref enumeration. Target range of 5-20 concurrent worktrees is well within safe bounds.

### Alternatives considered

- **Per-repo mutex in application layer**: Adds complexity. Git's internal locking is sufficient for our concurrency level (5-20 parallel sessions). Would only be needed at 100+ concurrent worktrees.
- **One bare clone per session**: Eliminates contention but defeats the purpose of shared mirrors. Rejected.

### Implementation notes

- Branch naming: `agent/{sessionId}` ensures uniqueness
- Worktree path: `/workspace/{sessionId}/repos/{repoName}`
- **Per-mirror flock**: Use `flock(2)` on a lockfile per bare clone for mutating operations (`fetch`, `worktree add/remove`, `gc`). Agent reads inside worktrees (status, diff, log) do not need the lock.
- On contention: retry `worktree add` up to 3 times with 100ms backoff
- Cleanup: `git worktree remove --force` on session end; `git worktree prune` periodically
- Disable auto-GC: set `gc.auto=0` on bare clones; run `git gc` on a schedule when no sessions are active
- Require Git ≥2.37 on sandbox for fetch+worktree scaling fix

---

## 2. Bare Clone Mirror Management

### Decision: Workspace-scoped bare clones at `/workspace/mirrors/{workspaceId}/{org}/{repo}.git`

### Rationale

Bare clones (`git clone --bare`) contain only the git object database and refs — no working tree. This makes them ideal as a shared source for worktrees:

- **Disk efficiency**: A bare clone is ~60-70% the size of a regular clone (no working tree files)
- **Fetch safety**: `git fetch` on a bare clone updates refs and downloads objects without modifying any working tree
- **Worktree creation**: `git worktree add <path> -b <branch>` from a bare clone is a local-only operation (<1s even for large repos)

### Sync strategy

1. **Webhook-triggered fetch**: GitHub `push` webhook → gateway → sandbox `POST /mirror/fetch`. Latency: 1-5s after push.
2. **Periodic fallback**: Cron job every 4 hours fetches all mirrors. Catches missed webhooks.
3. **Session-init check**: Before creating a worktree, check mirror freshness. If `lastFetchedAt` > 1 hour, do a quick fetch first.

### Disk management (LRU eviction)

- Monitor disk usage via `df` or `statfs` syscall
- When usage exceeds 80% threshold: identify least-recently-used mirrors (by `lastFetchedAt` + last worktree creation time)
- Evict mirrors with no active worktrees first
- Never evict a mirror that has active worktrees — wait for sessions to end
- Alert at 70% (warning) and 85% (critical)
- LRU eviction runs as part of the periodic cron job

### Alternatives considered

- **Shallow clones as mirrors**: Worktrees require full history for branch operations. Shallow clones cause `git worktree add` failures. Rejected.
- **S3-backed bundles**: 10-20s restore time per session. Slower than local bare clones. Deferred for cross-region scenarios.
- **Shared filesystem (NFS/EFS)**: Adds infrastructure dependency. Bare clones on local persistent disk are simpler and faster.

---

## 3. Event Taxonomy Migration

### Decision: Versioned events with dual-format consumer normalization

### Rationale

The current event system uses a flat `StreamEvent` interface with a discriminated union on `type`. The new taxonomy uses namespaced types (`agent:message`, `step:started`) with a structured `payload` field. Migration must be non-breaking since three consumers exist:

1. `apps/web/app/api/sessions/[id]/stream/route.ts` — SSE to browser
2. `apps/gateway/src/routes/stream.ts` — SSE to CLI/MCP clients
3. `packages/platform/src/events/run-stream.ts` — event publishing

### Migration approach

**Phase 1: Add normalization layer + switch producers**
- Add `normalizeEvent()` function to `packages/shared`
- Update `apps/agent/src/run-persistence.ts` (`publishEvent`) to emit V2 events with `v: 2` field — this is the single choke point
- SSE consumers (`apps/web`, `apps/gateway`) call `normalizeEvent()` on read to handle both V1 (replayed from stream history) and V2 events
- Update `apps/web/lib/ui/lib/chat-parts.ts` (`appendStreamEvent` / chat reducer) to accept normalized V2 shapes
- Update `isTerminalEvent` checks to recognize both `done`/`error`/`aborted` (V1) and `session:completed`/`session:failed` (V2)

**Phase 2: Add new event types**
- Add new types (`step:started`, `step:completed`, `user:message`, `planner:message`, `step:degraded`) as workspace features land
- No need to block taxonomy migration on workspace/planning work — these can ship independently

**Phase 3: Remove V1 support (after stream TTL window)**
- After 7-day retention window expires, all V1 events are naturally flushed
- Remove `normalizeEvent()` V1 fallback path
- Remove old `StreamEvent` type (replace with `StreamEventV2`)

### Why not flag-day migration

Redis stream replay keeps old event shapes for up to 24 hours (current `expireRunStream` TTL). A flag-day deploy would break reconnect/`Last-Event-ID` replay for in-flight runs. The normalize-on-read approach lets the web service display both old replayed history and new live events correctly during the transition.

### Discovered issues

- **`phase_changed` event**: Published by agent but not in `StreamEvent` union type. Must be added to new taxonomy.
- **`paused`/`resumed` events**: Published via `session.ts` using `events.publish(\`run:${runId}\`, ...)` which may target wrong pub/sub channel. Needs alignment with new event bus.
- **Stream is per-run, not per-session**: Stream key is `run:{runId}:events`. Event types like `session:completed` are naming alignment (the event still goes to the run's stream).

### Event serialization

Current: Redis Streams field `e` contains JSON string of `StreamEvent`.
New: Same field `e`, but JSON string includes `v: 2` discriminator.

```typescript
// Current
XADD run:{runId}:events * e '{"type":"token","token":"Hello"}'

// New
XADD run:{runId}:events * e '{"v":2,"type":"agent:message","ts":"...","payload":{"token":"Hello"}}'
```

### Event retention implementation

Redis Streams `XTRIM` with `MINID` strategy:
```typescript
// Hourly cron: trim events older than 7 days
const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
const minId = `${cutoff}-0`;
await redis.xtrim(streamKey, 'MINID', minId);
```

### Alternatives considered

- **New stream key per version**: `run:{runId}:events:v2`. Breaks existing consumers and doubles storage during migration. Rejected.
- **Protocol Buffers**: More efficient serialization but adds build complexity. JSON is sufficient for current event volume (~2000 events per run).

---

## 4. Workspace Service Architecture

### Decision: New `packages/platform/src/services/workspace.ts` service

### Rationale

Workspace config resolution is needed by both the agent worker (to inject env vars and secrets into the agent process) and the gateway (for the config CRUD API). Placing it in `packages/platform` follows the existing pattern (`session.ts`, `repo.ts` are there).

### Config resolution flow

```
Session creation request
  → Load workspace (project) from DB
  → Merge workspace.environmentConfig + session.sessionEnvOverrides
  → Resolve secrets (decrypt runtime tier)
  → Merge workspace.defaultSkills + session.sessionSkillsOverrides
  → Inject into agent job payload
```

### Secret handling

- Secrets stored encrypted in `projects.secrets_config` using `ENCRYPTION_KEY` (existing pattern from `packages/shared/lib/encryption.ts`)
- Env tier: decrypted and passed as env vars + included in LLM context
- Runtime tier: decrypted and passed as env vars with `__SECRET__` prefix; agent tool layer strips from LLM responses
- Build tier: only injected during Docker builds (future, not in scope for this phase)

### Alternatives considered

- **Separate `workspaces` table**: Adds migration complexity. The existing `projects` table already has the right shape and relationships. Rejected in favor of extending `projects`.
- **Vault/external secrets manager**: Over-engineered for v1. Encrypted JSONB is sufficient. Deferred.

---

## 5. Authorization Model

### Decision: Org-level admin/member roles for workspace configuration

### Rationale

The existing system has `orgs` and `orgMembers` (via the auth schema). Roles are already supported. The simplest authorization model reuses this:

- Org admins: can create, configure, and delete workspaces
- Org members: can launch sessions, view workspace config, add session-level overrides

### Implementation

- Gateway middleware checks `orgMembers.role` for workspace mutation endpoints
- Session creation checks membership only (any member can launch)
- No workspace-level roles in v1 (deferred per spec clarification)

### Alternatives considered

- **Workspace-level ACLs**: More granular but adds a new permission model. YAGNI for v1. Deferred.
- **No authorization**: All members can configure everything. Risky for secrets management. Rejected.

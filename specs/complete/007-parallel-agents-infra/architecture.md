# Architecture: Epic 1 — Parallel Agents & Dev Environments

**Date**: 2026-05-21 | **Status**: Decided

**Scope**: Milestone 1 (Parallel Agents) and Milestone 2 (Dev Environments)

---

## Summary

Three evolutionary changes to the existing agent infrastructure:

1. **Workspace model** — Promote `projects` to persistent workspaces that own repos, config, secrets, and skills across sessions. Enable multi-repo support from day one.
2. **Persistent repo mirrors + worktrees** — Bare clone mirrors on the sandbox disk, webhook-synced. Agent sessions create git worktrees instead of cloning from GitHub. Sub-second workspace setup.
3. **Unified event taxonomy** — Formalize the existing Redis Streams event bus with a structured event schema covering planning, execution, and steering phases.

These build on top of the existing architecture — the agent worker, Redis Streams job queue, sandbox service, crash recovery, and SSE streaming are kept and extended, not replaced.

---

## What Exists Today

```
Browser ──SSE──▶ Web App ──enqueue──▶ Redis Streams (agent:jobs:stream)
                    │                         │
                    │                         ▼
                    └──subscribe──▶ Redis ◀──publish── Agent Worker (apps/agent)
                                                │
                                                ├── agentLoop (LLM + tools)
                                                └── HTTP ──▶ Sandbox (/workspace/{sessionId})
                                                │
                                                └── read/write ──▶ Postgres
```

| Component | Current implementation |
|---|---|
| Agent execution | Separate worker process (`apps/agent`), up to 5 concurrent runs |
| Job queue | Redis Streams with consumer groups, at-least-once delivery, dead lettering |
| Event streaming | Redis Streams + Pub/Sub → SSE to browser |
| Crash recovery | Heartbeat monitoring, stale run reaping, PEL reclaim, retry |
| Cancellation | Redis abort keys, polled every 500ms |
| Git | Shallow clone (`--depth 50`) from GitHub per session into sandbox disk |
| Sandbox | Dedicated service with 20GB persistent disk at `/workspace/` |
| Session model | Session → Chat → AgentRun, one active run per chat |

---

## Change 1: Workspace Model

### The problem

Sessions are independent. Each session binds to one repo, resolves its own config, and shares nothing with other sessions. This means:

- No multi-repo: can't work across frontend + backend + shared libs in one task
- No persistent config: environment setup, secrets, and skills are re-resolved per session
- No shared context: parallel agents on the same project can't share repo access or environment

### The change

Promote the existing `projects` table into a **workspace** role. It already has `config`, `instructions`, and `projectRepos[]`. Extend it to own environment configuration, secrets, and compute defaults. Sessions become lightweight task records that inherit from their workspace.

```
Org → Project (= Workspace)
         ├── repos[] (projectRepos — multi-repo)
         ├── repo mirrors (bare clones on sandbox disk, webhook-synced)
         ├── skills & rules (speckit, custom, repo-sourced)
         ├── environment config, secrets
         └── Sessions (lightweight, inherit from workspace)
              └── Chat → AgentRun
```

| Concern | Today (session-centric) | Target (workspace-centric) |
|---|---|---|
| Repo binding | One `repoPath` per session | Multiple repos per workspace |
| Repo access | Clone from GitHub per session | Worktree from persistent mirror |
| Branch | One per session | Each session creates its own via worktree |
| Environment config | Per-session `projectConfig` | Workspace-level, inherited |
| Secrets | Resolved per-session | 3-tier, attached to workspace |
| Skills/Rules | Per-session `activeSkills` | Workspace defaults, overridable |
| Parallel agents | Independent, share nothing | Share workspace repos, config |

### Schema changes

```sql
ALTER TABLE projects ADD COLUMN environment_config JSONB;
ALTER TABLE projects ADD COLUMN secrets_config JSONB;
ALTER TABLE projects ADD COLUMN compute_defaults JSONB;
ALTER TABLE projects ADD COLUMN repo_mirror_status JSONB;
ALTER TABLE projects ADD COLUMN last_mirror_synced_at TIMESTAMPTZ;
```

### Secrets: three tiers

| Tier | Visibility | Mechanism |
|---|---|---|
| **Environment Variables** | Visible to agent in LLM context | Injected into agent process env |
| **Runtime Secrets** | Redacted from LLM context, visible in terminal | `__SECRET__` prefix; tool layer strips from LLM context |
| **Build Secrets** | Docker image builds only | BuildKit secrets; never present at runtime |

Secrets are configured at the workspace level and injected per-session. Different sessions from different workspaces receive only their workspace's secrets.

---

## Change 2: Persistent Repo Mirrors + Worktrees

### The problem

Every session does a shallow clone from GitHub (`git clone --depth 50`). This takes 10-30s depending on repo size. For multi-repo workspaces, it multiplies. With parallel agents, the same repo gets cloned repeatedly.

### The change

Maintain **persistent bare clones** of every workspace repo on the sandbox's persistent disk. Agent sessions create **git worktrees** from the local bare clone — a sub-second operation.

```
Sandbox persistent disk (/workspace/):
  /mirrors/{workspace_id}/{org}/{repo}.git   ← bare clone, webhook-synced

Agent session:
  git worktree add /workspace/{sessionId}/repos/{repoName} -b agent/{sessionId}
  → sub-second, no network
```

### Lifecycle

1. **First session for a repo**: No bare clone exists → full clone from GitHub → stored as bare clone on disk
2. **Webhook sync**: GitHub push events trigger `git fetch` on the bare clone
3. **Periodic fallback**: Cron fetches all mirrors every N hours in case webhooks were missed
4. **Agent session**: `git worktree add` from bare clone → sub-second → agent works on worktree
5. **Session end**: `git worktree remove` cleans up

### Performance

| Scenario | Time |
|---|---|
| Today: shallow clone from GitHub | 10-30s |
| **Target: worktree from local bare clone** | **<1s** |
| Fallback: no mirror exists yet | 10-30s (first time only) |

### Workspace layout (inside agent session)

```
/workspace/{sessionId}/
├── repos/
│   ├── frontend/          # worktree from bare clone
│   ├── backend/           # worktree from bare clone
│   └── shared-libs/       # worktree from bare clone
└── .agent/
    ├── config.json
    └── rules/              # merged .cursor/rules from all repos
```

### Fallback

If the bare clone mirror is unavailable or doesn't exist, the clone step falls back to the current behavior (shallow clone from GitHub). Logs a degraded-performance event but doesn't fail.

---

## Change 3: Unified Event Taxonomy

### The problem

The existing Redis Streams event bus works well mechanistically, but the event types are ad-hoc (`token`, `tool_call`, `file_changed`, `heartbeat`, `done`, `error`). There's no formal schema, no planning-phase events, and no steering events. This limits observability dashboards, audit trails, and the ability to build features on top of the event stream (like a planning/approval flow).

### The change

Formalize the event taxonomy with namespaced types covering all session phases. The transport mechanism (Redis Streams + Pub/Sub → SSE) stays the same.

```
session:{id} stream

Planning phase:
  { type: "user:message",       payload: { content: "Fix the login bug" } }
  { type: "planner:message",    payload: { content: "I see the auth module..." } }
  { type: "planner:context",    payload: { files: ["src/auth.ts"] } }
  { type: "plan:generated",     payload: { steps: [...] } }
  { type: "user:plan_approved", payload: {} }

Execution phase:
  { type: "step:started",       payload: { stepId: "clone", stepType: "git_clone" } }
  { type: "step:completed",     payload: { stepId: "clone", durationMs: 800 } }
  { type: "step:failed",        payload: { stepId: "clone", error: "..." } }
  { type: "agent:message",      payload: { content: "I'll start by..." } }
  { type: "agent:tool_call",    payload: { tool: "edit_file", args: { ... } } }
  { type: "agent:tool_result",  payload: { tool: "edit_file", result: "..." } }
  { type: "agent:heartbeat",    payload: { activity: "editing src/auth.ts" } }

Steering:
  { type: "user:message",       payload: { content: "Don't touch the API" } }
  { type: "user:interrupt",     payload: { action: "cancel" } }

Lifecycle:
  { type: "session:completed",  payload: { prUrl: "..." } }
  { type: "session:failed",     payload: { error: "..." } }
```

### What this enables

- **Planning/approval flow**: The planner agent can generate a plan and wait for `user:plan_approved` before the executor starts. Today the agent just starts executing immediately.
- **Mid-flight steering**: User messages during execution are structured events the agent checks between LLM iterations (extends the existing abort-key pattern).
- **Step-level observability**: Setup steps (clone, workspace setup) emit their own events, so the frontend can show granular progress during the 1-3s setup phase.
- **Audit trail**: Every event has a `type`, `payload`, and `ts`. Observability subscribers can build cost tracking, compliance logs, and usage dashboards from the stream.

### Migration

The existing event types (`token`, `tool_call`, `file_changed`, `done`, `error`, `heartbeat`) map 1:1 to the new taxonomy. The SSE endpoint translates old format to new for backward compatibility during the transition.

---

## What's NOT Changing

| Component | Status |
|---|---|
| Agent worker (`apps/agent`) | Kept. Extends to support workspace-aware job params |
| Redis Streams job queue | Kept. Job payload gains workspace fields |
| Redis Streams + Pub/Sub event bus | Kept. Event types formalized |
| Crash recovery (heartbeat, reaping, PEL reclaim) | Kept as-is |
| Sandbox service with persistent disk | Kept. Disk now also stores bare clone mirrors |
| SSE streaming to browser | Kept. Event format evolves |
| Cancellation via Redis abort keys | Kept. Extended with `user:interrupt` events |

---

## Decisions

1. **Workspace model**: Promote `projects` to workspaces. Multi-repo from day one.
2. **Repo strategy**: Persistent bare clone mirrors + git worktrees. Sub-second setup.
3. **Event taxonomy**: Formalized, namespaced event types. Planning, execution, steering phases.
4. **Infrastructure**: No new services. Extend existing agent worker, sandbox, and Redis.
5. **Secrets**: Three tiers (env vars, runtime, build) at workspace level.
6. **Fallback**: Mirror unavailable → fall back to GitHub clone. Graceful degradation.
7. **Planning methodology**: Opinionless platform. Speckit available as a workspace skill, not enforced.

## Open Questions

1. **Disk budget**: How much additional persistent disk for bare clone mirrors? Depends on workspace count × repo count × repo sizes.
2. **Webhook reliability**: If GitHub webhook delivery fails, how quickly does the mirror become stale? Periodic sync fallback interval.
3. **Planner agent**: Should the planner (task shaping before execution) run on the web service or the agent worker? Impacts latency and resource sharing.
4. **Concurrency scaling**: Current worker handles 5 concurrent runs. With sub-second setup, more agents can be active — what's the right concurrency limit per instance type?

---

## Future Directions

- **Two-tier planner/executor model**: Separate planning (interactive, always-on) from execution (autonomous, queued). Builds on the event taxonomy's planning-phase events.
- **Dev environments (Milestone 2)**: Workspace-scoped Render services (Postgres, web services) provisioned via Render API, shared across sessions. Auto-suspend on inactivity.
- **Isolation upgrades**: Process-level → container-level → VM-level as multi-tenant requirements emerge.
- **Render Workflows**: If Render adds persistent disk support for Workflow tasks, reconsider for container-level isolation with managed orchestration.

---

## References

- [Git Worktree](https://git-scm.com/docs/git-worktree)
- [Redis Streams](https://redis.io/docs/data-types/streams/)
- [BullMQ](https://docs.bullmq.io/) (considered for queue replacement if needed)
- [Render Background Workers](https://render.com/docs/background-workers)
- [Render Persistent Disks](https://render.com/docs/disks)
- [Render Private Networking](https://render.com/docs/private-network)
- [Render API](https://api-docs.render.com/reference)

- ALSO REMEMBER UI LIBRARY

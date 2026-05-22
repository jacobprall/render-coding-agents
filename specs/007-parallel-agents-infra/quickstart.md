# Quickstart: Parallel Agents Infrastructure

**Date**: 2026-05-22 | **Feature**: 007-parallel-agents-infra

## Prerequisites

- Existing development environment running (`bun install && bun run infra:up && bun run db:push && bun run dev`)
- PostgreSQL 16 + Redis running (via docker-compose)
- GitHub OAuth configured (for repo access)
- `.env` populated per `.env.example`

## What's Changing

This feature extends 4 existing apps and 3 packages. No new services to deploy.

### Modified Services

| Service | Changes |
|---------|---------|
| **apps/agent** | Concurrency 5→10, fetch-on-start, steering consumption, planning phase |
| **apps/sandbox** | Mirror validation, corruption recovery, webhook trigger |
| **apps/web** | Steering endpoint, plan approval endpoint, GitHub webhook route |
| **apps/gateway** | Steering + approval endpoints (mirror web API) |

### Modified Packages

| Package | Changes |
|---------|---------|
| **packages/db** | `mirrors` table, `webhook_subscriptions` table |
| **packages/platform** | Event types, workspace service, steering channel |
| **packages/shared** | Extended `StreamEventV2` types |

## Development Workflow

### 1. Schema Migration

After pulling the branch:

```bash
bun run db:push    # Applies new tables (mirrors, webhook_subscriptions)
```

### 2. Running Locally

No changes to the local dev workflow:

```bash
bun run dev        # Starts web + agent + sandbox + gateway
```

### 3. Testing Workspace Setup

Create a workspace with multiple repos via the UI or API, then start a session:

```bash
# Via CLI
bun run cli session create --workspace <workspace-id> --message "Fix the login bug"

# Observe mirror creation in sandbox logs
# Observe sub-second worktree setup after first clone
```

### 4. Testing Steering

While a session is running:

```bash
# Send a mid-flight message
curl -X POST http://localhost:4000/api/sessions/{id}/steer \
  -H "Content-Type: application/json" \
  -d '{"content": "Focus on the auth module, skip tests for now"}'
```

### 5. Testing Planning Flow

Start a session with planning mode enabled:

```bash
# The agent will generate a plan and pause
# Approve it:
curl -X POST http://localhost:4000/api/sessions/{id}/approve-plan \
  -H "Content-Type: application/json" \
  -d '{"approved": true}'
```

### 6. Simulating Webhook

```bash
# Trigger a mirror fetch (simulates GitHub push webhook)
curl -X POST http://localhost:3001/mirror/fetch \
  -H "Authorization: Bearer ${SANDBOX_SHARED_SECRET}" \
  -H "X-Session-Id: system" \
  -H "Content-Type: application/json" \
  -d '{"workspaceId": "<id>", "repoPath": "owner/repo"}'
```

## Environment Variables

### New (add to `.env`)

| Variable | Purpose | Default |
|----------|---------|---------|
| `MAX_CONCURRENT_RUNS` | Agent worker concurrency | `10` |
| `MIRROR_IDLE_SYNC_INTERVAL_MS` | Background cron interval for idle mirrors | `86400000` (24h) |
| `GITHUB_WEBHOOK_SECRET` | HMAC secret for verifying GitHub webhooks | (generate) |
| `PLANNING_ENABLED` | Feature flag for planning/approval flow | `false` |

### Existing (no changes)

| Variable | Purpose |
|----------|---------|
| `SANDBOX_SERVICE_HOST` | Sandbox service URL |
| `SANDBOX_SHARED_SECRET` | Auth between agent/web and sandbox |
| `ENCRYPTION_KEY` | Secrets encryption at rest |
| `REDIS_URL` | Redis connection |
| `DATABASE_URL` | PostgreSQL connection |

## Verification Checklist

After implementation, verify:

- [ ] `bun run dev` starts all services without errors
- [ ] Creating a workspace with 2+ repos works
- [ ] First session triggers mirror creation (takes 10-30s)
- [ ] Second session on same workspace uses worktree (<1s)
- [ ] Sending a steering message is acknowledged by agent
- [ ] Planning mode pauses after plan generation
- [ ] Plan approval transitions to execution
- [ ] 10 concurrent sessions run without crashes
- [ ] SSE stream shows new event types
- [ ] Existing SSE consumers still work (backward compat)

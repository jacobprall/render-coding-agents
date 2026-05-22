# Quickstart: Workspace Model, Repo Mirrors & Event Taxonomy

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Prerequisites

- Bun 1.2.14+
- Docker (for local Postgres + Redis + Sandbox)
- GitHub OAuth app configured (existing setup)

## Local Development Setup

```bash
# 1. Start infrastructure
bun run infra:up

# 2. Run the schema migration
bun run db:push

# 3. Start all services
bun run dev
```

## Testing the Workspace Model

### 1. Configure a workspace via gateway API

```bash
# Set workspace environment variables and secrets
curl -X PUT http://localhost:3002/api/v1/projects/{projectId}/workspace \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "environmentConfig": {
      "NODE_ENV": "development",
      "API_BASE": "https://api.example.com"
    },
    "secretsConfig": {
      "runtime": { "DB_PASSWORD": "localdev123" }
    },
    "defaultSkills": [
      { "source": "builtin", "slug": "speckit" }
    ]
  }'
```

### 2. Verify workspace config inheritance

```bash
# Create a session — it inherits workspace config
curl -X POST http://localhost:3002/api/v1/sessions \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "{projectId}",
    "repoPath": "org/repo",
    "title": "Test workspace inheritance"
  }'
```

### 3. Test additive session overrides

```bash
curl -X POST http://localhost:3002/api/v1/sessions \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "{projectId}",
    "repoPath": "org/repo",
    "title": "Test with overrides",
    "sessionEnvOverrides": { "DEBUG": "true" },
    "sessionSkillsOverrides": [{ "source": "user", "slug": "custom-skill" }]
  }'
```

## Testing Repo Mirrors

### 1. Check mirror status

```bash
curl http://localhost:3002/api/v1/projects/{projectId}/mirrors \
  -H "X-Api-Key: $API_KEY"
```

### 2. Trigger manual sync

```bash
curl -X POST http://localhost:3002/api/v1/projects/{projectId}/mirrors/sync \
  -H "X-Api-Key: $API_KEY"
```

### 3. Verify worktree creation (sandbox direct)

```bash
# Check sandbox disk status
curl http://localhost:3001/disk/status \
  -H "Authorization: Bearer $SANDBOX_SECRET"
```

## Testing Event Taxonomy

### 1. Subscribe to event stream

```bash
# SSE stream with V2 event format
curl -N http://localhost:3002/api/v1/sessions/{sessionId}/stream \
  -H "X-Api-Key: $API_KEY"
```

Expected V2 events:
```
data: {"v":2,"type":"step:started","ts":"...","payload":{"stepId":"workspace_setup","stepType":"worktree_create"}}
data: {"v":2,"type":"step:completed","ts":"...","payload":{"stepId":"workspace_setup","durationMs":120}}
data: {"v":2,"type":"agent:message","ts":"...","payload":{"content":"I'll start by..."}}
data: {"v":2,"type":"agent:tool_call","ts":"...","payload":{"tool":"edit_file","args":{...}}}
```

## Running Tests

```bash
# All tests
bun test

# Workspace-specific tests
bun test tests/platform/workspace.test.ts
bun test tests/agent/worktree-setup.test.ts
bun test tests/packages/sandbox/mirror.test.ts
```

## Key Files

| Concern | Path |
|---------|------|
| Workspace schema | `packages/db/schema/org.ts` |
| Session schema | `packages/db/schema/session.ts` |
| Event types | `packages/shared/lib/stream-types.ts` |
| Workspace service | `packages/platform/src/services/workspace.ts` |
| Mirror manager | `apps/sandbox/server/services/mirror-manager.ts` |
| Worktree handler | `apps/sandbox/server/handlers/worktree.ts` |
| Agent clone logic | `apps/agent/src/agent.ts` |
| Gateway workspace routes | `apps/gateway/src/routes/workspace.ts` |

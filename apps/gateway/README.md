# Gateway

Headless REST and MCP API for the OpenForge platform. The gateway exposes the same platform services as the web frontend, but without a browser — suitable for CLI tools, CI pipelines, MCP clients (Claude Desktop, Cursor), and custom integrations.

## Running locally

From the monorepo root:

```bash
bun run gateway
```

Or from this directory:

```bash
bun run dev    # watch mode with auto-reload
bun run start  # production
```

The server starts on port `4100` by default (override with `GATEWAY_PORT`).

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `REDIS_URL` | Yes | Redis connection string (used for streaming / pub-sub) |
| `GATEWAY_API_SECRET` | Yes | Shared secret for admin-level bearer authentication |
| `FORGEJO_INTERNAL_URL` | Yes | Internal URL of the Forgejo instance (e.g. `http://forgejo:3000`) |
| `FORGEJO_AGENT_TOKEN` | Yes | Forgejo API token used by the platform for automated git operations |
| `FORGEJO_WEBHOOK_SECRET` | No | HMAC secret used to verify incoming Forgejo webhooks |
| `CI_RUNNER_SECRET` | No | Shared secret for authenticating `POST /api/ci/results` callbacks (e.g. from GitHub Actions) |
| `ENCRYPTION_KEY` | No | AES key for encrypting secrets at rest |
| `GATEWAY_PORT` | No | HTTP listen port (default: `4100`) |

## Authentication

All endpoints under `/api/*` (except health, webhooks, and CI callbacks) require a bearer token.

```
Authorization: Bearer <GATEWAY_API_SECRET>
```

The gateway resolves the token to an admin `AuthContext`. Per-user API key lookup (via an `api_keys` table) is planned but not yet implemented — for now only the shared secret is accepted.

## Endpoints

### Health (public)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Liveness check — returns `{ status, checks }` |

### Webhooks (public)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/webhooks/forgejo` | Forgejo push/PR webhook receiver |
| `POST` | `/api/webhooks/github` | GitHub webhook receiver |
| `POST` | `/api/webhooks/gitlab` | GitLab webhook receiver |

### CI (public — uses `x-ci-secret` header)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/ci/results` | Ingest CI test/build results (caller sends `x-ci-secret`) |

### Sessions

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/sessions` | Create a new agent session |
| `POST` | `/api/sessions/:id/message` | Send a message (start/continue work) |
| `POST` | `/api/sessions/:id/reply` | Reply to an agent tool call |
| `POST` | `/api/sessions/:id/stop` | Stop the running agent |
| `POST` | `/api/sessions/:id/phase` | Update session phase |
| `PATCH` | `/api/sessions/:id/config` | Update session configuration |
| `GET` | `/api/sessions/:id/skills` | List active skills for session |
| `PATCH` | `/api/sessions/:id/skills` | Update active skills |
| `POST` | `/api/sessions/:id/spec` | Approve or reject a spec |
| `POST` | `/api/sessions/:id/auto-title` | Generate an auto-title |
| `GET` | `/api/sessions/:id/ci-events` | List CI events for session |
| `POST` | `/api/sessions/:id/review` | Enqueue a review job |
| `DELETE` | `/api/sessions/:id` | Archive session |

### Repositories

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/repos/import` | Import a repository |
| `GET` | `/api/repos/:owner/:repo/contents/*path` | Read file contents |
| `PUT` | `/api/repos/:owner/:repo/contents/*path` | Write file contents |
| `GET` | `/api/repos/:owner/:repo/agent-config` | Read agent config |
| `POST` | `/api/repos/:owner/:repo/agent-config` | Write agent config |
| `GET` | `/api/repos/:owner/:repo/branch-protection` | List branch protections |
| `POST` | `/api/repos/:owner/:repo/branch-protection` | Create branch protection |
| `GET` | `/api/repos/:owner/:repo/branch-protection/:branch` | Get branch protection |
| `DELETE` | `/api/repos/:owner/:repo/branch-protection/:branch` | Delete branch protection |
| `GET` | `/api/repos/:owner/:repo/secrets` | List repo secrets |
| `PUT` | `/api/repos/:owner/:repo/secrets/:name` | Set a secret |
| `DELETE` | `/api/repos/:owner/:repo/secrets/:name` | Delete a secret |
| `GET` | `/api/repos/:owner/:repo/actions/runs/:runId/test-results` | Get test results |
| `GET` | `/api/repos/:owner/:repo/actions/runs/:runId/artifacts` | List run artifacts |
| `GET` | `/api/repos/:owner/:repo/actions/artifacts/:artifactId` | Download artifact |
| `GET` | `/api/repos/:owner/:repo/actions/jobs/:jobId/logs` | Get job logs |

### Pull Requests

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/pulls/:owner/:repo` | Create a pull request |
| `PATCH` | `/api/pulls/:owner/:repo/:number` | Update a pull request |
| `POST` | `/api/pulls/:owner/:repo/:number/merge` | Merge a pull request |
| `GET` | `/api/pulls/:owner/:repo/:number/comments` | List PR comments |
| `POST` | `/api/pulls/:owner/:repo/:number/comments` | Create PR comment |
| `POST` | `/api/pulls/:owner/:repo/:number/comments/:commentId/resolve` | Resolve/unresolve comment |
| `GET` | `/api/pulls/:owner/:repo/:number/reviews` | List PR reviews |
| `POST` | `/api/pulls/:owner/:repo/:number/reviews` | Submit PR review |

### Organizations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/orgs` | List organizations |
| `POST` | `/api/orgs` | Create organization |
| `DELETE` | `/api/orgs/:org` | Delete organization |
| `GET` | `/api/orgs/:org/members` | List members |
| `PUT` | `/api/orgs/:org/members/:username` | Add member |
| `DELETE` | `/api/orgs/:org/members/:username` | Remove member |
| `GET` | `/api/orgs/:org/secrets` | List org secrets |
| `POST` | `/api/orgs/:org/secrets` | Set org secret |
| `DELETE` | `/api/orgs/:org/secrets/:name` | Delete org secret |
| `GET` | `/api/orgs/:org/usage` | Get usage metrics |

### Inbox

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/inbox` | List inbox items |
| `GET` | `/api/inbox/count` | Get unread count |
| `POST` | `/api/inbox/dismiss` | Dismiss items |
| `POST` | `/api/inbox/read` | Mark items read |

### Skills

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/skills` | List skills |
| `POST` | `/api/skills/install` | Install a skill from URL |
| `POST` | `/api/skills/sync` | Sync skills from remote sources |
| `GET` | `/api/skills/repo/:owner/:repo` | List repo-specific skills |

### Mirrors

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/mirrors` | List mirrors |
| `POST` | `/api/mirrors` | Create a mirror |
| `POST` | `/api/mirrors/:id/sync` | Trigger mirror sync |
| `DELETE` | `/api/mirrors/:id` | Delete a mirror |
| `POST` | `/api/mirrors/:id/resolve` | Resolve mirror conflict |

### Invites

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/invites` | List invites |
| `POST` | `/api/invites` | Create invite |
| `POST` | `/api/invites/accept` | Accept invite |

### Models

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/models` | List available LLM models |

### Notifications

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/notifications` | List notifications |

### Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/settings/api-keys` | List API keys |
| `POST` | `/api/settings/api-keys` | Create/update API key |
| `PATCH` | `/api/settings/api-keys/:id` | Update API key |
| `DELETE` | `/api/settings/api-keys/:id` | Delete API key |

### Streaming (SSE)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/stream/sessions/:id` | Real-time agent run events |
| `GET` | `/api/stream/inbox` | Inbox count polling stream |

### MCP

| Method | Path | Description |
|---|---|---|
| `POST` | `/mcp` | MCP Streamable HTTP endpoint |

## MCP usage

The gateway exposes an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server over Streamable HTTP at `/mcp`. Any MCP-compatible client can connect.

**Example — Claude Desktop / Cursor configuration:**

```json
{
  "mcpServers": {
    "forge": {
      "url": "https://<gateway-host>/mcp",
      "headers": {
        "Authorization": "Bearer <GATEWAY_API_SECRET>"
      }
    }
  }
}
```

Available MCP tools:

| Tool | Description |
|---|---|
| `create-session` | Create a new agent session |
| `send-message` | Send a message to a session |
| `reply-to-agent` | Reply to an agent tool call |
| `stop-session` | Stop the running agent |
| `archive-session` | Archive a session |
| `list-ci-events` | List CI events for a session |
| `import-repo` | Import an external repository |
| `get-file-contents` | Read a file from a repository |
| `put-file-contents` | Create/update a file in a repository |
| `get-agent-config` | Read `.forge/agent.json` config |
| `list-repo-secrets` | List repository secrets |
| `get-test-results` | Get parsed CI test results |
| `create-pull-request` | Open a pull request |
| `merge-pull-request` | Merge a pull request |
| `list-pr-comments` | List PR comments |
| `create-pr-comment` | Post a PR comment |
| `submit-pr-review` | Submit a PR review |
| `list-orgs` | List organizations |
| `create-org` | Create an organization |
| `list-org-members` | List org members |
| `get-usage` | Get usage metrics |
| `list-skills` | List available skills |
| `install-skill` | Install a skill from URL |
| `sync-skills` | Sync skills |
| `list-inbox` | List inbox items |
| `inbox-count` | Get unread count |
| `dismiss-inbox` | Dismiss inbox items |
| `list-mirrors` | List mirrors |
| `sync-mirror` | Trigger mirror sync |
| `list-models` | List available LLM models |

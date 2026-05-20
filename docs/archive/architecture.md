# Architecture

## System overview

coding-agents is a four-tier system: clients → application services → a shared platform layer → infrastructure.

All four application processes (web, gateway, agent, CLI) interact with the same typed domain services via the platform layer. No app contains business logic directly; route handlers and job processors are thin adapters that resolve auth and delegate to services.

**Apps:**

| App | Path | Role |
|-----|------|------|
| **Web** | `apps/web` | Next.js dashboard: auth, sessions/chat, repo browser, settings |
| **Gateway** | `apps/gateway` | Hono: REST, SSE streams, webhooks, CI callback, MCP server |
| **Agent** | `apps/agent` | Bun worker: Redis Streams consumer, LLM loop, tools, sandbox |
| **CLI** | `apps/cli` | `forge` commands: chat, list, send, stop, pause, resume, stream, config |

## Authentication

OpenForge uses **NextAuth v5** with **GitHub OAuth** as the primary authentication provider. Users sign in with GitHub and their OAuth token is used for all repository operations.

- **GitHub OAuth** handles both authentication and authorization. The OAuth token grants access to the user's GitHub repositories.
- User accounts live in the `users` table. OAuth tokens are stored in the `accounts` table (managed by NextAuth) and also bridged to `syncConnections` for agent use.
- Sessions use **encrypted JWTs** (no server-side session store). The JWT carries the user's forge token and `forgeType` so server components and API routes can call the correct forge API.
- A **credentials provider** (email + password) is also available as a fallback for admin accounts.

### ForgeType

Each session and user token is tagged with a `forgeType` (`github`, `gitlab`, or `forgejo`) that determines which forge provider adapter handles API calls. GitHub is the default.

### First admin setup

On first startup, if the `users` table is empty, the app creates an admin account from `ADMIN_EMAIL` and `ADMIN_PASSWORD`. This runs via the Next.js instrumentation hook.

### Inviting users

Users can sign in directly with GitHub OAuth. Admins can also invite users via `POST /api/invites` for email/password accounts. Invites expire after 7 days.

### AuthContext

Every platform service method takes an `AuthContext` as its first argument:

```typescript
interface AuthContext {
  userId: string;
  username: string;
  forgeToken: string;
  isAdmin: boolean;
}
```

Auth is resolved at the edge (NextAuth session or gateway API key) and threaded through to services.

## Platform layer (`packages/platform`)

The core of the system is a framework-agnostic service layer with 13 domain services and pluggable adapters for infrastructure concerns.

### Composition root

Two factory functions:

- **`createPlatform(config)`** — Takes a `databaseUrl` + Redis instance. Builds all adapters and services. Use in standalone processes (gateway, agent).
- **`createPlatformFromInstances(inst)`** — Takes pre-built `db` + `redis`. Use when the host owns connection lifecycle (e.g., Next.js with HMR-safe singletons).

```typescript
import Redis from "ioredis";
import { createPlatform } from "@openforge/platform/container";

const platform = createPlatform({
  databaseUrl: process.env.DATABASE_URL!,
  redis: new Redis(process.env.REDIS_URL!),
  // Optional overrides:
  // storage: new S3StorageAdapter(config),
  // cache: new MemoryCacheAdapter(),
  // notificationSink: new WebhookSink(url),
  // authProvider: new StaticTokenAuthProvider(tokens),
});
```

### Domain services

| Service | Responsibility | Key methods |
|---|---|---|
| **SessionService** | Agent session lifecycle, message dispatch, run control | `create`, `sendMessage`, `stop`, `reply`, `archive`, `updatePhase`, `updateConfig`, `getSkills`, `updateSkills`, `handleSpecAction`, `generateAutoTitle`, `enqueueReviewJob`, `listCiEvents` |
| **RepoService** | Repository CRUD, file operations, branch protection, secrets | `importRepo`, `getFileContents`, `putFileContents`, `getAgentConfig`, `writeAgentConfig`, `listBranchProtections`, `setBranchProtection`, `deleteBranchProtection`, `listSecrets`, `setSecret`, `deleteSecret`, `getTestResults`, `listArtifacts`, `downloadArtifact`, `getJobLogs` |
| **PullRequestService** | PR lifecycle, comments, reviews | `createPullRequest`, `updatePullRequest`, `mergePullRequest`, `listComments`, `createComment`, `listReviews`, `submitReview`, `resolveComment` |
| **OrgService** | Organization CRUD, members, secrets, usage quotas | `listOrgs`, `createOrg`, `deleteOrg`, `listMembers`, `addMember`, `removeMember`, `listSecrets`, `setSecret`, `deleteSecret`, `getUsage` |
| **InboxService** | PR event inbox with read/dismiss tracking | `list`, `countUnread`, `markRead`, `dismiss` |
| **SettingsService** | Encrypted LLM API key management | `listApiKeys`, `createOrUpdateApiKey`, `updateApiKey`, `deleteApiKey` |
| **SkillService** | Agent skill resolution, installation, sync | `listSkills`, `installSkill`, `syncSkills`, `listRepoSkills` |
| **ModelService** | Available LLM model discovery | `listModels` |
| **NotificationService** | Aggregated notification feed (CI failures, agent errors) | `list` |
| **InviteService** | User invitation lifecycle | `listInvites`, `createInvite`, `acceptInvite` |
| **MirrorService** | GitHub/GitLab repo mirroring | `list`, `create`, `sync`, `delete`, `resolveConflict` |
| **CIService** | CI result ingestion, webhook-driven CI updates, auto-fix | `handleResult`, `dispatchForEvent`, `enqueueSessionTriggerJob` |
| **WebhookService** | Forgejo/GitHub/GitLab webhook routing + side effects | `handleForgejoWebhook`, `handleGithubWebhook`, `handleGitlabWebhook` |

### Inbound event layer (`packages/platform/src/inbound`)

All external signals (webhooks, CI callbacks, Render deploys) are normalised into a canonical `InboundEvent` shape before any routing or dispatch logic runs.

```
Incoming webhook
  → Signature verification (provider-specific)
  → Adapter: parse raw body → InboundEvent { id, source, kind, repo, pr, payload }
  → InboundRouter: first-match-wins → RouteAction
  → InboundDispatcher: execute RouteAction (enqueue trigger / create session / ignore)
```

**Components:**

| File | Purpose |
|---|---|
| `inbound/types.ts` | `InboundEvent`, `RouteAction`, `SessionMatcher`, `InboundRoute` types |
| `inbound/adapters.ts` | `githubWebhookToInboundEvent`, `forgejoWebhookToInboundEvent`, `gitlabWebhookToInboundEvent`, `renderWebhookToInboundEvent` |
| `inbound/router.ts` | `InboundRouter` — evaluates the route table, emits `inbound.routed` / `inbound.ignored` logs |
| `inbound/default-routes.ts` | Default route table: coalesce PR sync, review comment, PR opened/merged, CI failure, deploy failure |
| `inbound/dispatcher.ts` | `InboundDispatcher` — executes `RouteAction`s, bridges to `ciService.enqueueSessionTriggerJob` |

**Route actions:**

| Action | When | Effect |
|---|---|---|
| `trigger_session` | review comment, PR event, CI failure | Calls `enqueueSessionTriggerJob` on matched sessions |
| `create_diagnostic_session` | Deploy failure | Calls `sessions.createFromDeployFailure` |
| `coalesce` | PR synchronize | Cancels `queued`/`running` agent runs for the PR, then executes inner action |
| `ignore` | Unknown / uninteresting events | No-op, logged |

**Idempotency:** Every processed delivery ID is stored in the `webhook_deliveries` table. Gateway routes check this table before processing — replayed or retried deliveries are safely no-op'd.

### Agent run state machine (`packages/platform/src/state-machine.ts`)

`AgentRunStateMachine` enforces valid `agent_runs.status` transitions. Prevents scattered ad-hoc status mutations.

```
queued  →  running  →  completed
            ↓            (terminal)
          aborted  ←  queued (cancel before pickup)
            ↓
          failed
            ↓
          error
```

| Status | Meaning |
|---|---|
| `queued` | Enqueued, waiting for a worker |
| `running` | Picked up by a worker |
| `completed` | Finished successfully |
| `aborted` | Cancelled (user request or coalesce) |
| `failed` | Unrecoverable runtime error |
| `error` | Infrastructure error (dead-letter, timeout) |

Use `runStateMachine.transition(current, event)` in services instead of direct status string assignments.

### Permissions layer (`packages/platform/src/permissions`)

Policy-based guardrails applied before/during agent runs. Three independent, composable guards:

| Guard | File | Purpose |
|---|---|---|
| **CostGuard** | `cost-guard.ts` | Per-task and per-turn USD spend limits + warning threshold |
| **ToolFilter** | `tool-filter.ts` | Allow/deny list for agent tool names |
| **CredentialRedactor** | `credential-redactor.ts` | Regex-based secret redaction from tool outputs and messages |

`resolvePolicy(overrides?)` merges caller config on top of `DEFAULT_POLICY`. The default policy has no cost limits, no tool restrictions, and a set of common credential patterns (OpenAI keys, GitHub PATs, Slack tokens, `password=` / `secret=` pairs).

### Pluggable adapters

Infrastructure concerns are abstracted behind interfaces. Default implementations use Redis, but any can be swapped at construction time.

| Interface | Default implementation | Purpose |
|---|---|---|
| **`QueueAdapter`** | `RedisQueueAdapter` (Redis Streams) | Agent job queue: `ensureGroup()`, `enqueue(job)` |
| **`EventBus`** | `RedisEventBus` (Streams + Pub/Sub) | Real-time run streaming, KV state (abort flags), history replay, reply back-channel |
| **`CacheAdapter`** | `RedisCacheAdapter` | Generic get/set/del cache with `getOrSet` helper |
| **`StorageAdapter`** | `S3StorageAdapter`, `LocalStorageAdapter`, `MemoryStorageAdapter` | Object store: `put`, `get`, `delete`, `list`, `getSignedUrl` |
| **`NotificationSink`** | `ConsoleSink` | Deliver user notifications (`WebhookSink`, `CompositeSink`, `NoopSink` also available) |
| **`AuthProvider`** | `StaticTokenAuthProvider`, `CompositeAuthProvider` | Map bearer token → `AuthContext` for gateway auth |

Additional testing variants: `MemoryCacheAdapter`.

### ForgeProvider

All git forge operations (repos, PRs, branches, reviews, CI, mirrors, orgs, secrets, webhooks) go through a `ForgeProvider` interface. Services call `getDefaultForgeProvider(auth.forgeToken)` — no direct HTTP calls to Forgejo.

Three implementations:
- **`ForgejoProvider`** — default, used in production
- **`GitHubProvider`** — for mirrored GitHub repos
- **`GitLabProvider`** — for mirrored GitLab repos

This means the backing forge can be swapped without changing agent tools or API routes.

## Agent architecture

### Worker process, not serverless

The agent runs as a persistent Bun worker process (a Render Worker service), not as a serverless function or one-shot workflow step.

- No cold start penalty — the worker is always running.
- Long-lived Redis connections enable `XREADGROUP` blocking reads with no polling overhead.
- In-memory state (accumulated assistant message parts, per-run tool state) is scoped to the process lifetime, not serialized on every step.
- Bounded concurrency via an in-process counter (`MAX_CONCURRENT_RUNS`, default 5).

### Redis Streams job queue

Jobs are enqueued with `XADD` and consumed with `XREADGROUP` on the `agent:jobs:stream` stream with consumer group `agent-workers`. Each job stays in the Pending Entry List until the worker calls `XACK` after reaching a terminal state (completed, aborted, or failed). If the worker dies mid-run, the job is automatically reclaimed via a periodic `XPENDING` + `XCLAIM` cycle. Dead-letter handling after max retries.

### Agent/sandbox separation

The agent does not run inside the execution environment. It runs alongside it and interacts through tools over an internal HTTP API via `HttpSandboxAdapter`.

- The agent accumulates context across many LLM turns without touching the filesystem until it's ready.
- The sandbox has no knowledge of the agent protocol or model.
- The two scale and deploy independently.

The sandbox is a Docker image you own (`infrastructure/sandbox/`). Default tooling: Node, Bun, Python, ripgrep, git. Add anything by editing the Dockerfile.

### LLM providers

Anthropic and OpenAI via the Vercel AI SDK (`generateText`). Anthropic models are dynamically fetched from the `/v1/models` API at startup; OpenAI models come from a static catalog in `packages/shared`. Per-user API keys are resolved from the database (encrypted with `ENCRYPTION_KEY`), falling back to environment variables.

### Step budgets

- Main agent: **50 steps** per run
- Subagent (`task` tool): **20 steps** per sub-run

On step limit, the agent appends a message asking the user to send another message to continue.

## Skill system

Agent behavior is controlled by which skills are active on a session. Skills replaced an earlier phase-based workflow engine.

Skills are markdown files with YAML frontmatter (`name`, `description`, `default`). They are resolved from three sources at session start and injected into the agent's system prompt:

| Source | Location | Scope |
|---|---|---|
| **Built-in** | `packages/skills/builtins/*.md` | Ship with the platform |
| **User** | `{username}/skills/skills/*.md` on Forgejo | Per-user, across all repos |
| **Repo** | `.forge/skills/*.md` in the project repo | Per-project |

Default active skills: Implementation, Verification, PR Delivery, Code Quality, React Best Practices, Next.js Best Practices. Users toggle skills per-session in the UI; repo-level skills auto-activate.

If resolution yields zero skills, the builtin **implementation** skill is used as a fallback.

Examples:
- Enable **Spec-first** to have the agent produce a structured spec via `submit_spec` and wait for approval before coding
- Enable **Thorough understanding** to have the agent read the codebase and ask clarifying questions before editing
- Disable verification skills to let CI catch issues instead
- Write custom skills to encode project-specific instructions, conventions, or constraints

## CI execution (GitHub Actions)

Repositories use **GitHub Actions** for CI. OpenForge does not run a custom in-repo workflow runner.

1. Workflows run on GitHub when you push or open/update PRs.
2. **GitHub webhooks** (`workflow_run`, `check_suite`, pushes, etc.) notify OpenForge so sessions, PR state, and the inbox stay in sync.
3. Optional: a workflow can **POST** structured test/build output to **`POST /api/ci/results`** on the web/gateway URL, using the shared **`CI_RUNNER_SECRET`** (sent as the `x-ci-secret` header). The app validates the callback, updates Postgres (`ci_events`, commit status where applicable), and can enqueue the agent for auto-fix on failure (capped at `maxCiFixAttempts`).

For repository browsing and logs, GitHub Actions runs and artifacts are read via the forge/GitHub integration exposed through platform services.

## Message persistence

The worker writes the assistant `chat_messages` row to Postgres after a run completes (or when a run is aborted with partial output). The `done` and `aborted` stream events carry the persisted `assistantMessageId` back to the browser. The client replaces its in-memory streaming bubble with the server-assigned ID, so a page reload shows the full conversation history.

## Data model

All application state lives in Postgres. Schema is defined in `packages/db/schema.ts` (Drizzle ORM):

| Table | Purpose |
|---|---|
| `users` | Identity, Forgejo link, `passwordHash`, `isAdmin` |
| `accounts` | OAuth/provider links (Forgejo tokens) |
| `sessions` | Agent workspaces / Forgejo repo binding |
| `chats` | Per-session chat + `activeRunId` |
| `chat_messages` | Message rows (`parts` JSON) |
| `agent_runs` | Run metadata |
| `specs` | Spec documents per session |
| `verification_results` | Verification run outputs |
| `ci_events` | CI/webhook-derived events |
| `pr_events` | PR lifecycle feed / inbox |
| `mirrors` | Mirror relationships |
| `sync_connections` | External provider OAuth tokens (GitHub/GitLab) |
| `llm_api_keys` | Encrypted LLM API keys (platform/user scope) |
| `user_preferences` | JSON preferences (default model, etc.) |
| `skill_cache` | Cached skill markdown |
| `usage_events` | Token/usage logging |
| `api_keys` | Gateway API keys (hashed) |
| `invites` | Invite flow + redemption |
| `verification_tokens` | Email/magic-link tokens |
| `webhook_deliveries` | Processed delivery IDs for inbound idempotency |

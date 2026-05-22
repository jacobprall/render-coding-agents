# render-coding-agents — Full Module Audit

**Date:** May 22, 2026
**Auditor:** GPT 5.5 (8 parallel subagents)
**Scope:** All modules in `apps/` and `packages/`

---

## Table of Contents

1. [apps/agent — Core AI Agent Runtime](#appsagent--core-ai-agent-runtime)
2. [apps/cli — Command-Line Interface](#appscli--command-line-interface)
3. [apps/gateway — Central API Server](#appsgateway--central-api-server)
4. [apps/sandbox — Sandboxed Execution Service](#appssandbox--sandboxed-execution-service)
5. [apps/web — Frontend Web Application](#appsweb--frontend-web-application)
6. [packages/db — Database Access Layer](#packagesdb--database-access-layer)
7. [packages/platform — Platform Service Layer](#packagesplatform--platform-service-layer)
8. [packages/shared — Shared Types, Schemas & Utilities](#packagesshared--shared-types-schemas--utilities)

---

## apps/agent — Core AI Agent Runtime

### 1. Module Contents Description

`apps/agent` is the execution engine for Coding Agents. It is a Bun/TypeScript worker package that consumes queued agent jobs, prepares a sandbox workspace, runs a multi-step LLM/tool loop, persists assistant output, streams events back to the UI, and optionally pushes branches / opens PRs.

The module is organized around a clear runtime pipeline:

- `src/worker.ts` is the process entry point. It validates `REDIS_URL` / `DATABASE_URL`, creates Redis clients, initializes model availability, starts worker heartbeat / stale-run reaping / pending-job reclaim loops, reads jobs from Redis Streams, resolves active skills, and calls `runAgentTurn()`.

- `src/agent.ts` is the main orchestration file. It claims a run, provisions a sandbox adapter, ensures the workspace exists, optionally runs a planner, resolves LLM keys, builds forge/workspace/project context, constructs tools, runs the agent loop, persists assistant messages, auto-creates PRs for changed repos, updates run/session status, publishes terminal events, and cleans up worktrees.

- `src/loop.ts` implements the actual agent loop. It repeatedly calls an `LLMProvider`, handles text/tool-use blocks, executes tools, appends tool results back into model context, streams tokens, tracks usage, retries transient LLM failures, compacts stale large tool results, and stops on end-turn, max tokens, abort, empty response, or step limit.

- `src/llm/*` abstracts providers behind `LLMProvider`. `anthropic.ts` and `openai.ts` both stream raw SSE responses via `fetch`, normalize provider-specific response formats into shared `ContentBlock` / `LLMResponse`, and translate shared tool definitions into Anthropic tools or OpenAI function tools.

- `src/tools/*` contains the model-callable tool surface: shell, git, read/write/edit, glob/grep, web fetch, PR operations, repo creation, CI log/diff fetch, ask-user, subagent delegation, todo tracking, spec submission, attach-repo, skill loading, and compacted-result retrieval.

- `src/skills/*` handles built-in, user, and repo skill metadata. Built-ins live in `src/skills/builtins/*.md`, parsed by lightweight frontmatter parsing.

- `src/run-persistence.ts` owns stream event publishing, assistant message upsert, tool-result merging, run status updates, heartbeat updates, and event stream expiry.

- `src/observability.ts` records LLM/tool/sandbox events into platform observability storage and optionally exports OTLP spans.

- `src/providers.ts` creates forge providers from user sync connections or env fallback tokens, and provisions reusable HTTP sandbox providers.

- `src/system-prompt.ts` assembles the base prompt, scratch-mode prompt, workspace notes, tool guidance, project instructions, and skill index.

### 2. Key Data Models, Data Flows, and Execution Chains

**Primary internal models:**

- `AgentJob` in `src/types.ts`: queued work payload with `runId`, `chatId`, `sessionId`, `userId`, chat messages, model choice, resolved skills, env/secrets, project context, trigger, workspace ID, and optional multi-repo metadata.

- `LLMMessage`, `ContentBlock`, `ToolDefinition`, `LLMResponse`, `LLMProvider` in `src/llm/types.ts`: provider-neutral message and tool protocol.

- `AgentTool`, `AgentStep`, `AgentLoopResult` in `src/loop.ts`: runtime tool wrapper, per-step execution record, and final loop output.

- `ForgeAgentContext` in `src/context/agent-context.ts`: dependency injection object passed into tools, containing sandbox adapter, forge provider, session ID, repo owner/name, branch/base branch, and callbacks for file/PR events.

- `ResolvedSkill` / `SkillSummary` in `src/skills/types.ts`: skill identity, display metadata, and markdown content.

**Main execution chain:**

1. `worker.ts` starts, calls `fetchAvailableModels()`, creates `PlatformContainer`, ensures the Redis consumer group, and enters the job loop.
2. `readOneJob()` returns a validated job. `resolveJobSkills()` calls `resolveActiveSkills()` and attaches `resolvedSkills`.
3. `processJob()` calls `runAgentTurn()`.
4. `runAgentTurn()` idempotently claims the run by checking `agentRuns.status`, provisions a sandbox via `getAdapter()`, and calls `setupWorkspace()`.
5. `setupWorkspace()` either prepares scratch mode, clones a single repo, or creates multi-repo worktrees/mirror-backed workspaces with fallback cloning.
6. Optional `runPlanner()` performs a read-only LLM planning pass and waits for approval through steering events.
7. `runTurn()` builds forge context, system prompt, workspace/project blocks, model provider, tool set, result store, redaction secret map, heartbeat loop, and merged abort controller.
8. `agentLoop()` calls the LLM, streams tokens as `agent:message`, executes tool calls, publishes `agent:tool_call` / `agent:tool_result`, persists incremental assistant state, and accepts steering messages between steps.
9. On completion, `runAgentTurn()` auto-pushes and opens PRs for repos with diff stats, upserts final assistant message, updates run/session status, writes session summary, publishes terminal events, expires Redis event streams, and removes worktrees.

**Event flow:**

- `evt()` in `run-persistence.ts` standardizes event shape as `{ v: 2, type, ts, payload }`.
- Events go through `publishEvent()` into `EventBus.publish(runId, JSON.stringify(event))`.
- Important event families include `agent:*`, `planner:*`, `plan:*`, `step:*`, `session:*`.
- Run status is duplicated into Redis keys like `run:${runId}:status`, while durable state lives in DB tables such as `agentRuns`, `chatMessages`, `sessions`, `prEvents`, and `specs`.

### 3. Key Architectural Decisions

The strongest architectural pattern is **layered dependency injection**:

- The worker depends on `@coding-agents/platform` for queue, DB, events, and observability boundaries.
- The agent depends on `SandboxAdapter` and `ForgeProvider` interfaces rather than concrete implementations.
- Tools receive `ForgeAgentContext`, which avoids global state and makes the tool layer mostly framework-agnostic.

Other major decisions:

- **Queue-driven worker model:** Redis Streams plus consumer groups provide durable job dispatch, bounded concurrency, pending reclaim, and dead-letter handling.
- **Provider-neutral LLM loop:** `loop.ts` does not know Anthropic or OpenAI details. Provider modules normalize streaming APIs into shared `ContentBlock` structures.
- **Model-callable tools as Zod schemas:** `defineTool()` stores `description`, `inputSchema`, and `execute`; `tool-registry.ts` converts Zod to JSON Schema for model tool definitions.
- **Sandbox-first execution:** All filesystem, git, and shell operations go through `SandboxAdapter`, not local process IO.
- **Scratch vs repo mode:** Scratch sessions get core file/shell/search/web tools plus `attach_repo`; repo sessions get git, PR, CI, review, spec, and forge tools.
- **Multi-repo support:** `AgentJob.repos` enables mirror/worktree setup under `repos/{name}` with a primary repo marker at `.agent/primary-repo`.
- **Streaming plus durable persistence:** The UI can render live stream events while `upsertAssistantMessage()` keeps durable chat state in sync after each step.
- **Compaction strategy:** Large stale tool results are replaced with compact pointers after two steps and retrieved later through `get_tool_result`.
- **Human-in-the-loop hooks:** `ask_user_question`, steering events, and optional planner approval give the agent a structured pause/approval mechanism.

### 4. Key Design Decisions (File Level)

- `worker.ts`: uses process-level `active` counter and fire-and-forget `processJob()` for concurrency. Graceful-drain behavior on `SIGTERM`/`SIGINT`, worker heartbeat keys, stale run reaping, pending reclaim, and always ACKs jobs in `finally`.

- `agent.ts`: centralizes orchestration, but is very large (~1,100 lines) and mixes run lifecycle, workspace setup, cloning, PR creation, summary persistence, prompt construction, and error handling. Uses explicit terminal reason mapping: `end_turn`, `step_limit`, `stopped`, `timeout`, `provider_transient`, `internal`.

- `loop.ts`: keeps the model loop provider-neutral and tool-neutral. Handles transient retry with hardcoded backoff, step limits, empty-response retries, token accounting, tool result formatting/redaction, and compacted output.

- `anthropic.ts`: implements Anthropic prompt caching by adding `cache_control` to the system block, last tool, and conversation prefix. Preserves thinking/signature blocks.

- `openai.ts`: adapts shared tool blocks into OpenAI chat-completions function calls and maps tool results into `role: "tool"` messages.

- `tools/bash.ts`: blocks `git push/fetch/pull` through bash to force authenticated git operations through `gitTool()`.

- `tools/git.ts`: temporarily rewrites `origin` to an authenticated URL for remote operations, then restores the plain URL in `finally`.

- `tools/file-events.ts`: computes LCS-based diffs and emits file change callbacks, with a large-file fallback to avoid quadratic blowups.

- `tools/web-fetch.ts` / `url-safety.ts`: includes SSRF protections, DNS resolution checks, content-type filtering, redirect validation, and port restrictions.

- `observability.ts`: batches observability events, sanitizes metadata, caps event volume, truncates metadata, redacts likely secrets, and optionally emits OTLP spans.

### 5. Strengths and Weaknesses

**Strengths:**

1. Solid separation of runtime concerns. Queue consumption, LLM calls, tool definitions, provider adapters, persistence, sandbox access, forge access, and observability are mostly distinct.
2. Clean tool abstraction: Zod schemas provide validation, JSON Schema generation exposes tools to models, and `ForgeAgentContext` provides dependency injection.
3. Operational robustness: heartbeats, stale-run cleanup, pending reclaim, dead-letter finalization, stream TTLs, turn timeout, user abort polling, transient LLM retries, and incremental message persistence.
4. Security-conscious choices: sandbox execution boundary, secret redaction before tool outputs re-enter model context, SSRF hardening for web fetches, authenticated git URL restoration, avoidance of raw git remote auth through bash.
5. The LLM abstraction is pragmatic. Anthropic and OpenAI differences are isolated in provider files.
6. The module anticipates long-running agent sessions through tool result compaction, live streaming, model steering, and session summaries.

**Weaknesses:**

1. **Skill resolution drift.** `worker.ts` resolves `resolvedSkills`, but `agent.ts` does not inject `resolvedSkills[].content` into the system prompt. It only logs slugs and uses `resolvedSkills.length` to add a generic git note. `resolveJobSkills()` passes empty `forgeUsername` and `projectRepoPath`, so user/repo skills cannot resolve meaningfully.
2. **`agent.ts` is a god module.** Over 1,100 lines handling many unrelated responsibilities.
3. **Shell command construction risk.** Several multi-repo clone/worktree/push/diff paths interpolate variables into command strings. Many are quoted, but this is more fragile than argv-style commands.
4. **No tests.** Given the complexity of `loop.ts`, `agent.ts`, URL safety, diff generation, skill resolution, and run terminal states, this is a meaningful gap.
5. **Documentation is stale.** `README.md` says the module runs via "Vercel AI SDK," but the implementation uses direct `fetch` calls. It references `@openforge/*` packages while imports are `@coding-agents/*`.
6. **GitHub-only forge provider.** `getForgeProviderForSession()` always queries provider `"github"`. Provider wiring is GitHub-specific despite multi-provider types.
7. **Subagent `taskTool()` is less controlled.** Does not receive parent abort signals, token streaming, observability recorder, result compaction store, or secret redaction.
8. **`ObservabilityRecorder.flushNow()` drops queued rows/spans on failure** because it splices queues before the try blocks and does not requeue.
9. **`mergeToolResults()` drops standalone unmatched `tool_result` parts.** If ordering or partial persistence produces a result before its call, the data would be lost.

---

## apps/cli — Command-Line Interface

### 1. Module Contents Description

`apps/cli` is a small terminal client for Render Coding Agents. It exposes the `rca` binary and lets a user configure gateway access, create sessions, send messages, list sessions, control active runs, and attach to a session event stream.

- `src/index.ts`: CLI setup with Commander.js, command registration
- `src/api.ts`: thin gateway HTTP client with SSE streaming
- `src/config.ts`: local configuration management (`~/.coding-agents/config.json`)

Commands: `config set/show`, `chat <message>`, `send <sessionId> <message>`, `list`, `stop/pause/resume <sessionId>`, `stream <sessionId>`.

### 2. Key Data Models, Data Flows, and Execution Chains

**Core Data Models:**

- `CliConfig`: `apiUrl` (default `http://localhost:4100`), optional `apiKey`, optional `defaultModel`. Persisted to `~/.coding-agents/config.json`.
- `ChatState`: `sessionId`, `isStreaming`, `messages` — in-memory state for active chat sessions.

**Key Flows:**

- **Chat Flow**: User types message → `chat` command → HTTP POST to gateway `/api/sessions` → SSE stream opens → stream chunks rendered in terminal → agent completes.
- **Streaming Flow**: `streamSession()` fetches `/api/stream/sessions/:sessionId` with `Accept: text/event-stream`, reads body via `ReadableStreamDefaultReader`, parses SSE manually.

**Critical contract issues identified:**

1. `sendMessage()` sends `{ message }`, but gateway `SendMessageSchema` expects `{ content }`. This likely makes `rca send` fail.
2. `listSessions()` calls `GET /api/sessions`, but the gateway does not define that route.
3. Streaming expects old event names like `"token"`, `"tool_call"`, `"done"`, while the gateway streams JSON envelopes with types like `agent:message`, `agent:tool_call`, `session:completed`.

### 3. Key Architectural Decisions

1. **Thin client architecture** — all business logic lives in gateway/agent; CLI is a pure client.
2. **SSE for streaming** — reuses the same SSE streaming protocol as the web UI.
3. **File-based configuration** — persists settings following CLI conventions.
4. **Interactive REPL mode** — chat command enters a persistent interactive session.
5. **Manual SSE parser** — no EventSource dependency; hand-rolled parser in `stream.ts`.

### 4. Key Design Decisions (File Level)

- `src/config.ts`: synchronous filesystem APIs; silently falls back to defaults on parse failure; API key stored plaintext; no file permissions restriction; no environment variable override.
- `src/api.ts`: loads config on every request; SSE parser does not handle multi-line `data:` frames; `currentEvent`/`currentData` scoped per decoded chunk so events split across chunks can be lost.
- `src/index.ts`: uses `process.exit(1)` in error handlers; streaming formatting duplicated between `chat` and `stream` commands; `RCA_DEBUG` prints otherwise unknown events.

### 5. Strengths and Weaknesses

**Strengths:**
1. Clean separation of concerns: commands, API transport, and config are distinct.
2. Consistent with web UI protocol (intended).
3. Low dependency footprint (`commander` only).
4. `AbortController` for clean SIGINT handling.

**Weaknesses:**
1. **API contract drift is the largest weakness.** At least three user-facing paths are broken or stale: wrong field name for send, missing list route, stale event names for streaming.
2. **Stream parser is fragile.** Does not fully implement SSE semantics, does not preserve state across chunks, does not normalize current v2 event envelope.
3. **No tests.** CLI is mostly contract glue, which breaks silently.
4. **Config security.** Bearer tokens stored plaintext without file permissions.
5. **Pause is misleading.** Platform warns pause signal is "not enforced" by the agent worker, but CLI exposes it as a real command.
6. **No tab completion, piping support, or auto-update.**

---

## apps/gateway — Central API Server

### 1. Module Contents Description

`apps/gateway` is a headless API gateway running on Bun with Hono. It exposes platform capabilities through four surfaces:

- REST API under `/api/*`
- SSE streams under `/api/stream/*`
- Webhook ingestion under `/api/webhooks/*`
- MCP Streamable HTTP under `/mcp`

The module is intentionally thin: most business behavior lives in `@coding-agents/platform`, while the gateway handles HTTP routing, auth resolution, request validation, response shaping, and transport-specific concerns.

Core files:
- `src/index.ts`: composition root with Hono app, middleware, routes
- `src/platform.ts`: lazily constructs singleton platform container
- `src/middleware/auth.ts`: resolves bearer tokens into platform `AuthContext`
- `src/routes/*`: REST/SSE/webhook route groups
- `src/mcp/*`: MCP tool surface (60 tools across sessions, repos, PRs, orgs, models, settings)
- `src/openapi.ts`: hand-written OpenAPI 3.1 spec plus Swagger UI

### 2. Key Data Models, Data Flows, and Execution Chains

**Auth flow:** Extract `Authorization` → if matches `GATEWAY_API_SECRET`, resolve impersonated user from `X-CodingAgents-User-Id` or first admin → otherwise SHA-256 hash token and look up in `api_keys` → load forge token from OAuth `accounts` then `syncConnections` → store `AuthContext` in Hono context.

**Session flow:** `POST /api/sessions` → validate `CreateSessionSchema` → optionally check workspace env override conflicts → call `platform.sessions.create`.

**Streaming flow:** `GET /api/stream/sessions/:id` → verify session ownership → read latest `chats.activeRunId` → subscribe to Redis pub/sub channel `run:${runId}` *before* replaying history → buffer pub/sub messages to reduce replay/live race window → replay history → flush buffered events → switch to live pub/sub → periodic pings → close on terminal events.

**Webhook flow:** `POST /github` → verify signature → convert to inbound event → record delivery IDs for idempotency → optionally trigger sandbox mirror fetches on push → dispatch through platform inbound router/dispatcher.

**MCP flow:** `/mcp` → `requireApiAuth` → reuse or create `McpServer` → register 60 tool groups → handle request through `WebStandardStreamableHTTPServerTransport`.

### 3. Key Architectural Decisions

1. **"Thin gateway, fat platform service" architecture.** Route handlers mostly translate HTTP into platform calls.
2. **Hono** for TypeScript-first design, performance, and edge runtime compatibility.
3. **Dual REST and MCP facades** over the same platform container.
4. **SSE replay via Redis streams/history plus pub/sub live fanout.** Subscribe before replay to avoid missing events.
5. **Webhook idempotency** through `webhookDeliveries` table.
6. **Zod as edge validation layer.** Most mutating routes define local schemas near the handler.
7. **Hand-written OpenAPI spec** rather than generated from routes/schemas.

### 4. Key Design Decisions (File Level)

- `src/middleware/auth.ts`: timing-safe equality for shared secret; supports impersonation via `X-CodingAgents-User-Id`; loads forge tokens from OAuth accounts first, then sync connections.
- `src/routes/sessions.ts`: many small route-local schemas; in-memory `Map` caches for repo/branch lists; prevents `sessionEnvOverrides` from shadowing workspace env keys.
- `src/routes/stream.ts`: shared Redis subscriber with per-request command connection; `channelListeners` fan out one subscription to multiple SSE clients; synthetic terminal events when run status indicates completion but history is missing terminal data.
- `src/routes/workspace.ts`: directly mutates DB rows and does admin checks locally rather than delegating to platform services — weakens the otherwise clean separation.
- `src/routes/webhooks.ts`: duplicates some auth-token parsing logic for generic webhooks rather than reusing `requireApiAuth`.
- `src/mcp/server.ts`: in-memory `Map` of MCP transport sessions with no size bound.

### 5. Strengths and Weaknesses

**Strengths:**
1. Clean adapter shape — most handlers stay short and delegate to platform services.
2. Central `AuthContext` gives REST and MCP the same identity model.
3. Consistent Zod validation for mutating routes.
4. Error handling avoids leaking unknown exception details.
5. SSE stream handling with replay, `Last-Event-ID`, buffering, terminal detection, and keepalives.
6. Webhook idempotency is a strong reliability choice.
7. MCP coverage is broad (60 tools).

**Weaknesses:**
1. **Documentation drift is significant.** README and OpenAPI mention surfaces not implemented: inbox REST routes, skills, mirrors, invites, notifications, Forgejo/GitLab webhooks, and some MCP tools.
2. **Test drift is significant.** `tests/mcp.test.ts` expects unregistered tool groups; `tests/routes.test.ts` references `/api/webhooks/forgejo` which doesn't exist.
3. **Auth logic duplicated** in generic webhook handling.
4. **`GATEWAY_API_SECRET` + impersonation** is powerful and should be carefully audited.
5. **Several path numeric params use `Number(...)` without NaN validation.**
6. **In-memory MCP sessions map and caches have no size bound.**
7. **`healthRoutes.get("/workers")` uses Redis `keys("worker:heartbeat:*")`** — expensive in production; should use `SCAN`.
8. **`workspace.ts` directly mutates DB** rather than using platform services.
9. **Generic webhook auth permits fallback to bearer** when HMAC fails — mixed auth semantics.
10. **OpenAPI spec is hand-maintained and already stale.**

---

## apps/sandbox — Sandboxed Execution Service

### 1. Module Contents Description

The sandbox module is a TypeScript/Bun package named `@coding-agents/sandbox`. It provides:

- A client-side API (`SandboxAdapter`, `HttpSandboxAdapter`, `SandboxProvider`) used by the agent process to talk to a sandbox service.
- A Bun HTTP server (`server/server.ts`) that runs inside a Docker container and performs filesystem, shell, git, snapshot, mirror, and worktree operations under `/workspace`.

The Docker image (Ubuntu-based) includes Node 22, Bun, Python, git, ripgrep, fd, tar, unzip, and build tooling. It creates a non-root `sandbox` user and runs on port `3001`.

### 2. Key Data Models, Data Flows, and Execution Chains

**Core models** (from `types.ts`): `ExecResult`, `FileReadResult`, `GlobResult`, `GrepResult`/`GrepMatch`, `GitResult`, `SnapshotResult`, `VerifyCheck`/`VerifyResult`, `HealthResult`.

**Client flow:** Agent obtains provider → provider returns cached `HttpSandboxAdapter` → adapter serializes calls to HTTP endpoints with `X-Session-Id`, optional bearer auth, and optional signed session token → server authenticates, validates session binding, routes to handler → handler resolves session workspace under `/workspace/{sessionId}` → handler returns typed JSON.

**Shell execution chain:** `/exec` → `handleExec()` → `getSessionGitCwd()` → `runCommand()` runs `bash -lc` with ulimits and timeout → output capped by `MAX_OUTPUT_BYTES`.

**Git execution chain:** `/git` → `handleGit()` → `validateGitArgv()` blocks dangerous flags and enforces allowed subcommand list → `runArgv(["git", ...args])` executes without shell interpolation.

**File operations:** `validatePath()` resolves paths under `/workspace/{sessionId}`; existing paths checked with `realpathSync()` to detect symlink escapes; reads/writes capped at 5 MB; writes post-write realpath-checked.

**Mirror/worktree subsystem:** `ensureMirror()` stores bare mirrors under `/workspace/mirrors/{workspaceId}/{repoPath}.git`; creates per-session worktrees; `startPeriodicSync()` refreshes mirrors on interval; `disk-monitor.ts` evicts least-recently-accessed mirrors when usage crosses threshold.

### 3. Key Architectural Decisions

1. **Adapter/provider boundary** — agent depends on `SandboxAdapter` interface, not disk operations directly. Clean seam for replacing the sandbox backend.
2. **Route-per-capability handler structure** — `server.ts` handles cross-cutting concerns; `server/handlers/*.ts` contain operation-specific logic.
3. **Session-scoped filesystem isolation** — every operation anchored under `/workspace/{sessionId}` with `SAFE_SANDBOX_ID_PATTERN`.
4. **Layered authentication** — bearer auth via `SANDBOX_SHARED_SECRET`; session binding via HMAC token with `sid`, `uid`, `exp` claims. Production startup refuses to run without both secrets.
5. **Separate execution models** — shell for general commands (intentionally), argv+policy for git (safer).
6. **Resource limits at multiple layers** — request body size, read/write size, output size, execution timeouts, shell ulimits, glob caps, snapshot cleanup, mirror eviction.

### 4. Key Design Decisions (File Level)

- `interface.ts`: defines high-level sandbox capability contract including both basic and newer mirror/worktree/disk operations.
- `adapter.ts`: normalizes hosts to `http://`/`https://`, centralizes request behavior, injects auth headers.
- `session-token.ts`: compact HMAC-signed token rather than JWT dependencies; uses `timingSafeEqual` and base64url encoding.
- `server/lib/path-security.ts`: normalizes relative paths, validates `repos/{name}` segments, checks resolved paths stay inside session root, validates realpaths for existing paths.
- `server/lib/process.ts`: two execution modes (`runArgv()` and `runCommand()`); limits child environment variables, bounds output reads, applies timeouts, attempts process-group killing.
- `server/lib/git-policy.ts`: allows pragmatic subset of git subcommands; blocks dangerous global flags.
- `server/services/mirror-manager.ts`: uses `execSync()` and `Bun.sleepSync()` which block the event loop.
- `lib/security-audit.ts`: lightweight self-audit endpoint that verifies path traversal defense, auth config, env allowlist, timeout assumptions, and git policy.

### 5. Strengths and Weaknesses

**Strengths:**
1. Strong per-session filesystem path validation with logical resolution + realpath checks + post-write symlink escape check.
2. Meaningful process execution guardrails: timeout killing, output caps, env allowlisting, shell ulimits.
3. Production-aware authentication with `assertProductionSecretsOrExit()`.
4. Git endpoint uses argv execution and subcommand policy rather than raw shell wrapper.
5. Mirror/worktree strategy is architecturally valuable for performance.
6. Dockerfile runs as non-root user with useful baseline toolchain.

**Weaknesses:**
1. **Mirror/worktree service is highest-risk area.** `mirror-manager.ts` constructs shell commands with interpolated `workspaceId`, `repoPath`, `cloneUrl`, `branchName`, `baseBranch` from HTTP bodies without validation/escaping. Command-injection and path-traversal risk.
2. **Mirror paths not session/path hardened** the way file operations are. `mirrorPath()` joins raw values into `/workspace/mirrors`.
3. **Some handlers trust body `sessionId` rather than authenticated `X-Session-Id`.** `handleWorktreeCreate()` and `handleWorktreeRemove()` use `body.sessionId`.
4. **`execSync()` and `Bun.sleepSync()` in mirror-manager block the event loop.** Long mirror operations can stall unrelated requests.
5. **`handleGrep()` has no match/output cap** comparable to `MAX_OUTPUT_BYTES`. Large repos or broad patterns can produce high memory use.
6. **Snapshot restore extracts over workspace without clearing first** — may leave stale files.
7. **README uses `@openforge/sandbox`** while actual package is `@coding-agents/sandbox`.
8. **Tests import from `../../../packages/sandbox`** but the package is at `apps/sandbox`.

---

## apps/web — Frontend Web Application

### 1. Module Contents Description

`apps/web` is the Next.js 15 browser application. It owns the user-facing shell, authentication screens, session/chat UI, settings, repo/file browsing, git review panels, observability dashboard, and App Router API handlers.

Architecturally, it is a thin Next.js adapter over shared workspace packages: `@coding-agents/platform` owns business services, `@coding-agents/db` owns schema, `@coding-agents/shared` owns event/types/encryption utilities.

Major surfaces: sessions home/create, session detail/chat workspace, settings (profile, GitHub connection, tokens, preferences, team invites), observability (event log, usage dashboard), and ~30 API routes.

### 2. Key Data Models, Data Flows, and Execution Chains

**Authentication:** `SignInForm` → NextAuth `signIn("credentials")` → bcrypt verify → JWT callbacks build `forgeToken`, `forgeUsername`, `forgeType`, `isAdmin` → `UserSession` wrapped in `React.cache`.

**Session creation:** `SessionsHome.handleSend()` → `apiFetch("/api/sessions", { POST })` → `requireForgeAuth()` → `getPlatform().sessions.create()` → return `sessionId` + `activeRunId`.

**Chat and SSE:**
- Client: `ChatPanel` → `useAgentChat()` → `useEventSource()` opens `/api/sessions/[id]/stream` → SSE events parsed as `StreamEvent` → `chatReducer` converts to UI state via `appendStreamEvent()`.
- Server: `/api/sessions/[id]/stream` → authenticate → verify ownership → read `activeRunId` → subscribe Redis pub/sub *before* replaying history → buffer pub/sub during replay → flush → switch to live → keepalive pings → close on terminal events.

**Stream event → UI part flow:** `lib/ui/lib/chat-parts.ts` maps `agent:message` → text, `agent:tool_call` → tool_call part, `agent:tool_result` → attach result, `agent:ask_user` → ask-user prompt, `step:*` → task parts, `agent:file_changed` → file change parts.

**File tree and git:** Sandbox-backed via `lib/sandbox-client.ts`. `useFileTree()` → SWR from `/api/sessions/[id]/files?path=...` → `listDirectory()` runs `find` in sandbox. `useGitStatus()` refreshes every 5 seconds via `/api/sessions/[id]/git/status`.

### 3. Key Architectural Decisions

1. **Thin Next.js adapter over platform services** — most routes authenticate, parse minimal input, call `getPlatform()`, return JSON.
2. **Singleton resources** via `globalThis` for DB, platform container, Redis.
3. **Explicit auth context boundary** — `requireAuth()` vs `requireForgeAuth()` for identity-only vs repo-access.
4. **Server components for initial data, client components for interaction.**
5. **Redis-backed durable streaming** with replay via `Last-Event-ID`.
6. **Reducer-based chat state** centralizing streaming, terminal events, file changes, ask-user prompts.
7. **SWR consistently** for client data fetching (models, sessions, repos, file tree, git status, settings).
8. **Dynamic imports** for heavy UI (ChatPanel, FilesView, markdown, tool renderers).

### 4. Key Design Decisions (File Level)

- `lib/sandbox-client.ts`: wraps sandbox `/exec`, `/read`, `/git` endpoints. Detects binary extensions before read, truncates content over 500 KB.
- `components/session/chat-reducer.ts`: pure reducer handling terminal flushing, step-limit detection, ask-user prompts, live file changes, streaming part appends.
- `hooks/use-agent-chat.ts`: encapsulates SSE setup, id dedupe, no-active-run retry loop, optimistic send, auto-title trigger.
- `app/api/sessions/[id]/stream/route.ts`: most complex route; Node runtime, force dynamic, Redis command/sub connections, validates ownership, replays history, buffers live messages, emits SSE frames.
- `components/layout/session-tabs.tsx`: stores open tabs in `localStorage` with imperative `window.__sessionTabs` bridge — pragmatic but globally coupled.
- `components/code-block.tsx`: client-loads Shiki, renders via `dangerouslySetInnerHTML`.

### 5. Strengths and Weaknesses

**Strengths:**
1. Clear module boundary — `apps/web` owns Next/UI glue while platform owns domain logic.
2. Good App Router usage with authenticated route groups, async params, server-side redirects.
3. Strong session ownership checks in file/git/session-specific routes.
4. Redis SSE replay design accounts for reconnect/resume.
5. Chat state well centralized in `chatReducer`.
6. Dynamic imports avoid loading expensive views before needed.
7. Server pages fetch independent data in parallel.
8. Sensitive tokens encrypted for sync connections.
9. Middleware CSRF policy plus `apiFetch()` provides basic protection.

**Weaknesses:**
1. **Input validation is inconsistent.** Many mutation routes pass `req.json()` directly to platform without Zod validation.
2. **Sandbox path handling needs hardening.** `listDirectory()` constructs shell command containing user-controlled `dirPath`. `readFileContent()` and `getFileDiff()` don't reject `..` traversal.
3. **Stubbed features exposed as real.** Fake commit route (`commitSha: "0000000"`), empty skills list, no-op skill install/sync.
4. **Client/server contract bugs.** `SessionWorkspace.handleCommit()` double-stringifies JSON body. `useEventSource()` does `HEAD` fetch on error but stream route only implements `GET`.
5. **OAuth state not fully CSRF-strong** — random `csrf` field not stored server-side or in cookie.
6. **Observability filter vocabulary drift** — DB uses `tool_call`/`sandbox_exec`, UI uses `tool_execution`/`sandbox_command`.
7. **Global browser bridges** (`window.__sessionTabs`) add implicit coupling.
8. **Rate limiting only in-memory** in middleware — not global across instances.
9. **`/api/health/workers` uses expensive Redis `keys()` pattern.**

---

## packages/db — Database Access Layer

### 1. Module Contents Description

`packages/db` is a schema-only package that defines the monorepo's shared Postgres data model using Drizzle ORM. It exports table definitions and inferred TypeScript row types, but intentionally does not own connection creation, query services, migrations, or business logic.

**Schema files by domain:**
- `schema/auth.ts`: users, NextAuth accounts, verification tokens, invites
- `schema/session.ts`: sessions, chats, messages, agent runs, specs, verification results
- `schema/ci.ts`: CI events and PR lifecycle events
- `schema/sync.ts`: external forge connections and repo mirrors
- `schema/infra.ts`: desired infra specs, actual resources, infra actions, observations
- `schema/platform.ts`: LLM/API keys, user preferences, usage events, skill cache, LLM calls, budgets
- `schema/org.ts`: orgs, projects, project repos, mirror sync log
- `schema/webhooks.ts`: webhook delivery idempotency
- `schema/observability.ts`: normalized agent event series and agent event logs

### 2. Key Data Models, Data Flows, and Execution Chains

**Auth and Onboarding:** `users` → `accounts`/`verificationTokens` (NextAuth) → `invites` (pre-provision user row, store invite token, later set `passwordHash`).

**Session, Chat, and Agent Runs:** `sessions` → `chats` → `chatMessages` (JSON `parts`) → `agentRuns` (status, model, trigger, timing, token/cost, heartbeat, terminal reason).

**Execution chain:** `SessionService.create()` inserts sessions + chats → inserts chatMessages + agentRuns → sets `chats.activeRunId` → enqueues agent job → agent persists via `upsertAssistantMessage()` → `updateRunStatus()` updates agentRuns, clears activeRunId, marks session.

**Platform/Cost:** `llmApiKeys` with partial unique indexes for platform-vs-user scoping → `llmCalls` as detailed cost ledger → `budgets` for monthly limits → `usageEvents` for coarser quota.

**Observability:** `eventSeries` normalizes `(sessionId, eventType)` → `agentEvents` stores durable event logs.

### 3. Key Architectural Decisions

1. **Schema-only package** — connection lifecycle and services live in apps/platform.
2. **Domain-file decomposition** — tables split by bounded context.
3. **Drizzle table-first contract** — downstream code imports table objects and uses inferred `$inferSelect`/`$inferInsert` types.
4. **No repository abstraction** — services query tables directly.
5. **JSONB for flexible surfaces** — configs, skills, message parts, payloads, metadata, secrets.
6. **Cascading deletes** for core session graph.
7. **Append/log-oriented tables** for history (infraActions, prEvents, mirrorSyncLog, llmCalls, agentEvents).

### 4. Key Design Decisions (File Level)

- `schema/auth.ts`: follows NextAuth naming; keeps forge-specific DB column names while exposing forge-agnostic property names.
- `schema/session.ts`: stores chat `parts` and `modelMessages` as JSONB to preserve rich message formats.
- `schema/platform.ts`: partial unique indexes for LLM key scoping; typed JSONB for `UserPreferencesData`.
- `schema/observability.ts`: exports enum arrays as `as const`, deriving types from values; identity integer IDs for normalized series, text IDs for events.

### 5. Strengths and Weaknesses

**Strengths:**
1. Clear domain boundaries make schema easy to navigate.
2. Very small dependency surface (drizzle-orm only), no runtime DB driver.
3. Drizzle inferred types give downstream services a shared compile-time contract.
4. Good use of partial unique indexes in `llmApiKeys`.
5. Thoughtfully normalized observability model.
6. Workspace model supports multi-repo, inherited config, per-session overrides, and mirror status.
7. Webhook idempotency as a first-class table.

**Weaknesses:**
1. **Many logical foreign keys missing.** `sessions.userId → users.id`, `sessions.projectId → projects.id`, `users.orgId → orgs.id`, `syncConnections.userId → users.id`, `prEvents.userId → users.id`, `usageEvents.userId → users.id`, `apiKeys.userId → users.id`, and several infra references.
2. **Most enum constraints are TypeScript-only.** Drizzle `text(..., { enum })` improves types but doesn't provide DB-level enforcement.
3. **Migration/schema drift.** Initial migrations created `sessions.repo_path`, `branch`, `base_branch` as non-null; current schema allows nullable. `agentRuns.lastHeartbeatAt` and `mirrorSyncLog.createdAt` are `TIMESTAMPTZ` in migrations but plain `timestamp` in schema.
4. **`chatMessages.runId` has migration FK to `agent_runs(id)` but schema defines it as plain `text("run_id")`.**
5. **Some redundant indexes** alongside unique constraints (e.g., `api_keys_hashed_key_idx` alongside `hashedKey.unique()`).
6. **`updatedAt` columns not automatically updated** by schema-level hooks.
7. **README says `@openforge/db`** while package.json exports `@coding-agents/db`.
8. **No Drizzle `relations()` definitions** — joins remain ad hoc.
9. **`schema/auth.ts` imports from `next-auth/adapters`** but `packages/db/package.json` doesn't declare `next-auth`.

---

## packages/platform — Platform Service Layer

### 1. Module Contents Description

`packages/platform` is the framework-agnostic business/service layer. Its composition root (`src/container.ts`) builds a `PlatformContainer` containing:

- **Infrastructure:** `db`, `queue`, `events`, `cache`, optional `storage`, optional `authProvider`, `notificationSink`
- **Services:** `sessions`, `repos`, `pullRequests`, `orgs`, `settings`, `models`, `ci`, `webhooks`, `costs`, `invites`, `observability`, `inboundRouter`, `inboundDispatcher`

Two construction modes: `createPlatform(config)` (creates its own DB/Redis) and `createPlatformFromInstances(inst)` (reuses externally owned instances).

Major areas:
- `src/interfaces/*`: adapter contracts for DB, auth, queue, events, cache, storage, notifications
- `src/storage/*`: S3, local filesystem, and memory object-storage adapters
- `src/queue/job-queue.ts`: Redis Streams based agent job queue with Zod validation and stale-job reclaim
- `src/events/run-stream.ts`: Redis Stream/PubSub helpers for run events, steering, ask-user replies
- `src/forge/*`: normalized forge provider abstraction and partial GitHub REST adapter
- `src/services/*`: domain services for all business operations
- `src/inbound/*`: canonical inbound event model, route rules, dispatcher
- `src/policy/*`: permissions, tool filtering, budget checks, pricing, credential redaction
- `src/state-machine.ts`: canonical `agent_runs.status` transition model

### 2. Key Data Models, Data Flows, and Execution Chains

**Message execution chain:**
1. `SessionService.sendMessage()` → authorize by sessionId + userId → validate model through `resolveLlmApiKeys()` → find/create latest chat → abort any active queued/running run → insert chatMessages + agentRuns → update chats.activeRunId → read full chat history → resolve workspace config/env/secrets/skills → `queue.enqueue()` writes `ValidatedAgentJob` to `agent:jobs:stream`.

**Queue lifecycle:** `enqueueJob()` → Redis Stream `agent:jobs:stream` → workers `XREADGROUP` → Zod validate → `ackJob()` → `reclaimStalePending()` handles retries and dead letters.

**Run event lifecycle:** `publishRunEvent()` → Redis Stream `run:{runId}:events` (MAXLEN ~2000) + PubSub `run:{runId}` → `readRunEventHistoryDetailed()` for replay → `publishSteeringEvent()` to both pub/sub and queue.

**Inbound event flow:** Raw provider event → `githubWebhookToInboundEvent()` → `InboundRouter.evaluate()` scans `DEFAULT_ROUTES` first-match-wins → `InboundDispatcher.dispatch()` executes action (trigger_session, coalesce, create_diagnostic_session, ignore).

### 3. Key Architectural Decisions

1. **Dependency injection through composition root.** Services consume `PlatformDb`, `QueueAdapter`, `EventBus` abstractions.
2. **Direct Drizzle usage in services** — no repository layer. Straightforward and type-aware but tightly coupled to schema.
3. **DB row + Redis job for async execution.** Durable agentRuns + chatMessages rows, separate at-least-once Redis queue.
4. **Redis Streams + PubSub for eventing.** Streams provide replay/history; PubSub provides live fanout.
5. **Pure router + side-effecting dispatcher** for inbound events.
6. **Functional policy layer** — pure utilities for tool filtering, credential redaction, cost checks.
7. **First-class observability** — `agentEvents` + `eventSeries` with process-local series cache.

### 4. Key Design Decisions (File Level)

- `src/state-machine.ts`: encodes lifecycle transitions in `TRANSITIONS` table; `assertValidTransition()` used in pause/resume but bypassed elsewhere.
- `src/queue/job-queue.ts`: Zod validation is strong for jobs crossing process boundaries; bad payloads logged and ACK'd to avoid poison pills.
- `src/events/run-stream.ts`: `MAXLEN ~ 2000`; steering events in both PubSub and Redis list queue for live + catch-up.
- `src/forge/github-adapter.ts`: large partial GitHub adapter with many `notImplemented()` operations.
- `src/inbound/default-routes.ts`: ordered first-match-wins route rules; PR synchronize as coalescing action.
- `src/services/session.ts`: central orchestration service handling creation, messages, stop/pause/resume, phase updates, replies, config, skills, specs, auto-title, CI events, deploy-failure sessions, webhook sessions, review jobs.
- `src/policy/credential-redactor.ts`: skips invalid regexes instead of crashing.

### 5. Strengths and Weaknesses

**Strengths:**
1. Clear intent and useful layering: container, interfaces, adapters, services, policy, inbound routing.
2. Robust queue design: Redis Streams, consumer groups, Zod validation, pending-entry reclaim, retry counts, dead-letter reporting.
3. Thoughtful run-event design combining stream history with PubSub live delivery.
4. Strong inbound router/dispatcher split keeping matching logic pure.
5. Credentials handled with care: encrypted LLM keys, key hints, provider validation, hashed access tokens, timing-safe comparisons.
6. Services are host-agnostic — receive `AuthContext` and injected dependencies.
7. Simple and composable policy layer.

**Weaknesses:**
1. **No local tests.** Significant gap given orchestration, status transitions, queue behavior, and security-sensitive key handling.
2. **Public surface advertises more than implemented.** README mentions `InboxService`, `SkillService`, `MirrorService`, `NotificationService` not in actual container.
3. **Forge abstraction only partially realized.** `GitHubProvider` has many `notImplemented()` operations called by services.
4. **Architectural overlap between `src/inbound/*` and `src/services/webhook/*`.** Both parse/handle GitHub events with different coverage.
5. **Status mutations bypass state machine.** Many paths set `agentRuns.status` directly instead of using `assertValidTransition()`.
6. **Likely bug in pause/resume event path.** `SessionService.pause()` calls `this.events.publish(\`run:${runId}\`, ...)`, which creates `run:run:<id>:events` (double prefix).
7. **`InboundDispatcher.cancelActiveRunsForPR()` marks runs as "aborted" in DB but doesn't set Redis abort flags.** Worker may continue.
8. **`LocalStorageAdapter.keyToPath()` joins `basePath` and `key` without preventing `../` traversal.**
9. **`InviteService.createInvite()` stores invite tokens in plaintext** — inconsistent with access-token hashing.
10. **`ObservabilityService.queryEvents()` joins `agentRuns` only by `sessionId`** — can duplicate events across runs.

---

## packages/shared — Shared Types, Schemas & Utilities

### 1. Module Contents Description

`packages/shared` is a cross-package contract and utility package providing shared types, error classes, logging, stream event contracts, encryption helpers, forge provider interfaces, model metadata, workspace config types, and CI test-result parsers.

Key files:
- `index.ts`: curated barrel export
- `lib/errors.ts`: `AppError` hierarchy with domain subclasses
- `lib/api-types.ts`: `ApiSuccessResponse<T>`, `ApiErrorResponse`, `isApiError()`
- `lib/stream-types.ts`: canonical `StreamEvent` envelope (v:2), `StreamEventType`, `isTerminalEvent()`
- `lib/workspace-types.ts`: `SecretsConfig`, `RepoMirrorStatus`, `SessionSummary`, `WorkspaceConfig`, `ResolvedWorkspaceConfig`
- `lib/forge/types.ts`: normalized forge entities and operation parameter types
- `lib/forge/provider.ts`: `ForgeProvider` interface with operation groups
- `lib/encryption.ts`: AES-256-GCM helpers for encrypted tokens
- `lib/llm-key-validation.ts`: validates provider API keys by making live API calls
- `lib/model-catalog.ts`: static OpenAI model catalog
- `lib/ci/test-results.ts`: JUnit XML and TAP output parsers
- `lib/logger.ts`: minimal structured JSON logger
- `lib/request-id.ts`: request ID generation and extraction

### 2. Key Data Models, Data Flows, and Execution Chains

**Error flow:** Services throw `AppError` subclasses → gateway `onError` calls `err.toJSON()` → returns `err.httpStatus`.

**Stream event flow:** Agent creates events with `evt(type, payload)` → `publishEvent()` serializes to Redis → gateway/web SSE forwards → UI `chatReducer` consumes `StreamEvent` → `isTerminalEvent()` detects terminal events.

**Forge provider flow:** `ForgeProvider` interface in shared → `GitHubProvider` in platform implements it → services program against normalized interface.

**LLM key flow:** `validateAnthropicApiKey()`/`validateOpenAiApiKey()` make live API calls → `encryptLlmApiKey()` encrypts → `llmKeyHint()` masks → platform stores/resolves/decrypts at runtime.

### 3. Key Architectural Decisions

1. **Single shared package for all contracts** — simplifies cross-service sharing but creates coupling point.
2. **Interface-driven forge architecture** with capability interfaces (RepoOperations, FileOperations, etc.).
3. **Versioned stream envelope** (`v: 2`) — good for long-term compatibility.
4. **Central error hierarchy** with stable codes, HTTP status mapping, retryability.
5. **Source-based package exports** — `.ts` files directly, assumes all consumers can transpile.
6. **Minimal runtime dependencies** — `zod` declared but currently unused in shared.

### 4. Key Design Decisions (File Level)

- `lib/errors.ts`: subclasses for domains; uppercase snake case codes; `toJSON()` returns API-friendly envelope; `ExtraErrorFields` prevents overriding `code`/`httpStatus`/`message`.
- `lib/stream-types.ts`: `StreamEvent.type` is `string` not `StreamEventType` — union is advisory not enforced; payload is `Record<string, unknown>`.
- `lib/encryption.ts`: AES-256-GCM with 12-byte IV and 16-byte auth tag; storage format is `base64(iv || ciphertext || authTag)`; `decryptTokenSafe()` returns `"DECRYPTION_FAILED"` instead of leaking.
- `lib/forge/provider.ts`: splits capabilities into operation interfaces; optional auth methods acknowledge provider differences.
- `lib/ci/test-results.ts`: regex-based JUnit XML parsing (lightweight but fragile); TAP diagnostic collection likely buggy — trims before checking indentation.

### 5. Strengths and Weaknesses

**Strengths:**
1. Strong package boundary centralizing contracts across web, gateway, platform, agent.
2. Good error taxonomy with stable codes, statuses, retryability, JSON serialization.
3. Solid forge abstraction divided by capability.
4. Stream event versioning for long-term compatibility.
5. Encryption uses authenticated encryption (AES-256-GCM) and avoids leaking encrypted blobs.
6. Structured JSON logger is lightweight and broadly usable.

**Weaknesses:**
1. **`package.json` exports `./client` but `client.ts` does not exist.** Any consumer importing `@coding-agents/shared/client` will fail.
2. **README is stale** — refers to `@openforge/shared`, claims no runtime network calls, documents missing client entry point.
3. **Root export includes server-only encryption** using `node:crypto` — not client-safe.
4. **`StreamEvent.type` is `string` not `StreamEventType`** — event names documented but not enforced.
5. **`StreamEvent.payload` is completely untyped** (`Record<string, unknown>`).
6. **No runtime schemas used** despite `zod` being declared. Notable at trust boundaries.
7. **`llm-key-validation.ts` performs network calls** from a supposedly lightweight shared package — better owned by platform.
8. **`parseJUnitXML()` is regex-based** and fragile for escaped entities, namespaces, CDATA.
9. **TAP parser likely fails to collect indented YAML diagnostics** — trims whitespace before checking indentation.
10. **No test coverage** for parsers, encryption, request IDs, stream terminal detection, model catalog, LLM validation.
11. **Logger has no redaction strategy** — callers could accidentally log secrets.
12. **Default encryption salt is static** — deployments using passphrase-style key get predictable derivation.

---

## System-Level Analysis

### Overall Architecture

render-coding-agents is a well-decomposed monorepo implementing an AI coding agent platform with a clear vertical layering:

```
packages/shared (contracts, types, errors, encryption)
    ↓
packages/db (Drizzle schema, domain-partitioned tables)
    ↓
packages/platform (framework-agnostic services, queue, events, policy, forge)
    ↓
apps/gateway (Hono REST/SSE/MCP transport)   apps/web (Next.js 15 UI + API routes)
    ↓                                              ↓
apps/agent (Bun worker, LLM loop, tools)     apps/cli (Commander.js terminal client)
    ↓
apps/sandbox (Bun HTTP sidecar in Docker container)
```

This layering is the system's strongest architectural quality. Business logic concentrates in `packages/platform`, which is framework-agnostic and host-agnostic — it receives injected `PlatformDb`, `QueueAdapter`, and `EventBus` abstractions rather than importing Next.js, Hono, or Bun specifics. Both `apps/gateway` and `apps/web` act as thin transport adapters over the same platform container. The agent is a standalone worker process that consumes the same platform queue and event infrastructure. The sandbox is a self-contained sidecar behind a clean `SandboxAdapter` interface. This separation means the system could, in principle, swap transport layers, execution environments, or even the sandbox backend without rewriting domain logic.

The dependency graph is disciplined. `packages/shared` sits at the bottom with no upward dependencies. `packages/db` depends only on `drizzle-orm`. `packages/platform` depends on `db` and `shared` but not on any app. Apps depend downward into packages but not laterally into each other — gateway does not import web code, and agent does not import gateway code. This is a textbook clean-architecture dependency rule.

### The Streaming Pipeline

The most sophisticated cross-cutting concern is the real-time event pipeline that connects agent execution to user-visible UI:

1. Agent emits versioned `StreamEvent` objects (`{ v: 2, type, ts, payload }`) via `run-persistence.ts`
2. Events are published to Redis Streams (`run:{runId}:events`, MAXLEN ~2000) for durability and to PubSub (`run:{runId}`) for live fanout
3. Gateway and web SSE endpoints subscribe to PubSub *before* replaying stream history, buffer live events during replay to minimize the race window, then switch to live delivery with keepalive pings
4. Browser-side `useEventSource` hook consumes the SSE stream, and `chatReducer` converts events into typed UI state via discriminated `ChatPart` unions
5. Terminal events (`session:completed`, `session:failed`, `session:aborted`) trigger cleanup on both server and client

This design handles reconnection via `Last-Event-ID`, detects missing terminal events through Redis status keys, and synthesizes them when needed. The replay-then-live handoff with buffering is careful engineering that avoids the common SSE race condition where events emitted between history read and subscription start are lost.

However, the pipeline is also where the most cross-module bugs surface. The CLI expects a completely different event vocabulary (`"token"`, `"done"`) than what the system actually produces (`agent:message`, `session:completed`). Platform's `pause`/`resume` path likely double-prefixes event channels (`run:run:<id>`). The web observability UI uses filter labels that don't match actual event type strings in the database. These are symptoms of a protocol that evolved without a single enforcing contract — `StreamEvent.type` is `string`, not a union, and `StreamEvent.payload` is `Record<string, unknown>`, so producers and consumers can silently diverge.

### Redis as System Backbone

Redis serves triple duty across the system: durable job queue (Streams with consumer groups), event delivery (Streams for history plus PubSub for live fanout), and ephemeral coordination state (keys for run status, abort flags, worker heartbeats, steering queues, ask-user reply queues). This is a pragmatic architectural choice that keeps infrastructure simple — one Redis instance instead of separate message brokers, event stores, and coordination services — but it means Redis is a hard single point of failure. There is no fallback path if Redis is unavailable: job dispatch stops, streaming stops, abort signals are lost, and worker health monitoring goes dark. The system's operational resilience is directly coupled to Redis uptime.

The queue design itself is robust. Zod-validated payloads prevent poison-pill jobs. Consumer groups provide bounded concurrency. Stale-pending reclaim handles worker crashes. Dead-letter finalization marks failed runs. Stream TTLs prevent unbounded growth. This is production-grade queue engineering for a system that processes one job type.

### Security Posture

The system demonstrates security awareness at multiple layers. Sandbox path validation uses logical resolution plus `realpathSync` to catch symlink escapes, with post-write verification. Git commands use argv execution with a subcommand policy rather than shell interpolation. Web fetch tools include SSRF hardening with DNS resolution checks, port restrictions, and redirect validation. Secrets are redacted from tool outputs before re-entering model context. API keys are stored as SHA-256 hashes. LLM provider keys use AES-256-GCM with authenticated encryption. Token comparisons use timing-safe equality. The sandbox Docker container runs as a non-root user. Production startup refuses to proceed without authentication secrets configured.

The most significant security gap is the mirror/worktree subsystem in `apps/sandbox`. While the core per-session file and exec operations are carefully hardened, `mirror-manager.ts` constructs shell commands by interpolating `workspaceId`, `repoPath`, `cloneUrl`, `branchName`, and `baseBranch` from HTTP request bodies without validation or escaping. Mirror paths are not subject to the same path-security validation as session file operations. Some worktree handlers trust `body.sessionId` rather than the authenticated `X-Session-Id` header. These represent command-injection and path-traversal vectors in a subsystem that operates with the same filesystem privileges as the hardened core. The architectural contrast is stark: the system invested heavily in securing per-session operations, then added a mirror subsystem that bypasses those protections.

A secondary concern is that several in-memory data structures (MCP session maps, repo/branch caches, channel listener maps) have no size bounds. In a long-running production gateway, these could grow without limit under sustained high-cardinality workloads.

### The Testing Gap

The most consistent finding across all eight module audits is the near-total absence of tests. `apps/agent` has no tests despite being the most complex module in the system — the LLM loop, tool execution, URL safety, diff generation, skill resolution, and run terminal state transitions are all untested. `packages/platform` has no tests despite owning all business logic, status transitions, queue behavior, and security-sensitive key handling. `packages/shared` has no meaningful test coverage for parsers, encryption, stream terminal detection, or model catalog. `apps/cli` has no tests despite being almost entirely contract glue — the type of code that breaks silently. `apps/gateway` and `apps/sandbox` have some tests, but they reference routes, tool groups, and import paths that no longer exist, making them actively misleading rather than merely absent.

This is the system's highest-priority technical debt. The codebase has significant complexity in its streaming pipeline, state machine transitions, queue lifecycle, security validation, and cross-module contracts. These are exactly the areas where tests provide the most value — preventing regressions in behavior that is difficult to verify manually, catching contract drift between modules early, and documenting the intended behavior of edge cases (What happens when a run is aborted mid-tool-call? What if a steering event arrives after a terminal event? What if the sandbox returns a symlink escape on a write?). The current system relies entirely on type checking and manual testing for correctness, which is insufficient for the complexity level.

### Documentation and Naming Drift

The system underwent a rename from `@openforge/*` to `@coding-agents/*` that is incomplete. READMEs in `packages/db`, `packages/shared`, and `apps/sandbox` still reference the old name. The agent README claims the module uses the "Vercel AI SDK" when it actually uses direct `fetch` calls against provider APIs. `packages/shared` exports a `./client` entry point in its `package.json` that points to a file that does not exist. The gateway's hand-written OpenAPI spec documents routes, webhook handlers, and MCP tools that are not implemented. Test files reference routes (`/api/webhooks/forgejo`) and tool groups (`list-projects`, `list-skills`, `create-mirror`) that don't exist in the current codebase. `apps/web/drizzle.config.ts` doesn't include `mirror_sync_log` in its table filter despite the table existing in the schema and migrations.

These are not cosmetic issues. Stale documentation actively misleads contributors about what the system does. Stale tests provide false confidence. Missing exports cause runtime failures for downstream consumers. Each instance is small, but collectively they indicate that documentation and tests are not maintained as part of the development workflow — they are written once and then drift.

### Contract Enforcement

The system has strong compile-time contracts through TypeScript and Drizzle's inferred types, but weak runtime contracts at process and service boundaries. `StreamEvent.type` is `string` rather than the `StreamEventType` union, so event producers can emit arbitrary names without type errors. `StreamEvent.payload` is `Record<string, unknown>`, shifting correctness to consumers. Many web API routes pass `req.json()` directly to platform services without Zod validation at the HTTP boundary. The CLI sends `{ message }` where the gateway expects `{ content }`. `zod` is declared as a dependency in `packages/shared` but not actually used there.

The system would benefit from a stronger contract enforcement strategy: discriminated event types at the type level, Zod schemas at every process boundary (HTTP, Redis, IPC), and shared request/response schemas between producers and consumers rather than ad-hoc local schemas in each route handler.

### Incomplete Abstractions

Several abstractions are designed for generality but only partially implemented. The `ForgeProvider` interface supports GitHub and GitLab, but only `GitHubProvider` exists, and many of its operations throw `notImplemented()` — yet platform services call some of those unimplemented operations. The skill system resolves skills in the worker but doesn't inject their content into the system prompt. The run state machine defines valid transitions in a `TRANSITIONS` table, but many status mutations bypass `assertValidTransition()` and write directly to the database. The inbound event router/dispatcher coexists with an older `WebhookService` that handles overlapping event types through a different code path.

These partial abstractions create a specific kind of risk: contributors see the abstraction and assume it works, then build on it without realizing the implementation is incomplete. The forge abstraction is the clearest example — services written against `ForgeProvider` will compile and appear correct, but fail at runtime when they hit a `notImplemented()` path on the only concrete provider.

### God Modules and Decomposition

Three files stand out as concentration points that should be decomposed. `apps/agent/src/agent.ts` is over 1,100 lines and handles run lifecycle, workspace setup, repository cloning, PR creation, summary persistence, prompt construction, and error handling — at least four distinct responsibilities. `apps/web/components/layout/sidebar.tsx` is 614 lines handling navigation, session list, search, grouping, responsive behavior, and project switching. `packages/platform/src/services/session.ts` is the central orchestration service handling session creation, messages, stop/pause/resume, phase updates, replies, config, skills, specs, auto-title, CI events, deploy-failure sessions, webhook sessions, and review jobs.

Each of these files is individually comprehensible, but their breadth means that changes to one responsibility risk regressions in others, and the cognitive load of understanding the full file before making a change slows development. The system's otherwise clean module decomposition breaks down at these specific points.

### Verdict

render-coding-agents is a well-architected system with strong fundamentals: clean vertical layering, disciplined dependency direction, a thoughtful streaming pipeline, security-conscious execution boundaries, and a powerful composition-root service container. The core data flow — user message through platform queue to agent worker to sandbox execution to streamed response — is robustly engineered with heartbeats, abort signals, dead-letter handling, replay, and terminal detection.

The system's weaknesses are concentrated in three areas. First, the absence of tests across all modules makes the system's correctness dependent on type checking and manual verification, which is insufficient for its complexity. Second, documentation, naming, and contract drift have created a gap between what the system says it does and what it actually does — stale READMEs, broken test references, non-existent exports, and a CLI that no longer matches the gateway protocol. Third, the mirror/worktree subsystem in the sandbox has not been brought to the same security standard as the core session operations, creating an inconsistency that is more dangerous than a uniformly weaker posture because it may be overlooked.

The highest-leverage improvements would be: (1) adding focused tests around the streaming pipeline, run lifecycle state machine, queue retry/dead-letter behavior, and sandbox security validation; (2) reconciling all documentation, naming, and package exports with the current implementation; (3) hardening the mirror/worktree subsystem with the same path validation and argv execution patterns used by the core sandbox; and (4) enforcing runtime contracts at process boundaries with shared Zod schemas rather than ad-hoc local validation.

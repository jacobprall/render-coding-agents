# Technical Deep Dive — working title: "How to build your own coding agent platform"

## Introduction
The next generation of software will be written in large part by AI. Platforms like Cursor and Devin let you rent agents to generate code on their fully managed infrastructure. They are turn-key solutions, but they come with some downsides:

- **Cost.** You pay a premium on top of every token in and out.
- **Opacity.** Black-box internals make debugging and optimizing a challenge.
- **Lock-in.** Your workflows live on someone else's platform. No escape hatch if pricing changes, features are deprecated, or the service goes down.

So we built a 1-click deployable, fully-featured coding agent platform. With `coding-agents`, you get:

- Scalable, fault-tolerant, long-running coding agents
- A modern streaming chat UX
- Automations, integrations, and observability built in

The platform deploys via Blueprint to Render, or via Docker anywhere.

Today I'll break down the architecture and implementation. The patterns are applicable to many kinds of distributed, multi-service, and agentic applications.

## Goals and Constraints

### Deployment Scope: One Team, Self-Hosted

This is the most important constraint, and it shapes everything below. `coding-agents` is designed for **a single team to deploy for themselves** — your engineering org, your CI, your codebase. It is **not** a multi-tenant SaaS platform meant to host arbitrary users' untrusted code.

That assumption buys us a lot:

- **Logical isolation** between sessions instead of per-session VMs or microVMs.
- **Shared infrastructure** (one sandbox service, one Redis, one Postgres) instead of per-tenant stacks.
- **Simple auth** — users in your org, not the public internet.
- **No quota / billing / rate-limit plumbing** beyond what's needed to keep one team's costs sane.

The trade is **blast radius**: a compromised agent session can affect other sessions on the same host. For a trusted team that's acceptable; for hosting strangers' code it isn't. We call out the line throughout. The architecture is built to upgrade to stronger isolation when the requirement appears (see "Future: Per-Session Isolation").

### Agent Capabilities
- **Autonomous, long-running agents** that can run for minutes to hours without supervision, survive transient failures, and resume from checkpoints.
- **Fully featured** — skills, tool calling, sub-agents, file operations, shell access — the full palette a coding agent needs to ship real work.
- **Token-efficient** — aggressive context management to keep costs low and context windows effective.

### Architectural Constraints
- **Isolated *enough*** — each session is namespaced and path-confined within a shared sandbox service. Strong enough for a trusted team; not a substitute for VM-level isolation.
- **Fully observable** — every agent action, tool call, and state transition is traceable end-to-end, with optional OTLP export to any backend.
- **Fault-tolerant and scalable** — the system recovers from crashes without losing agent state. Many agents run concurrently across many workers.

### Developer Experience Goals
- **Modern streaming UX** — real-time token streaming, sub-second perceived latency.
- **Pluggable / no lock-in** — swap LLM providers, tool implementations, or hosting platforms without rewriting the core. Everything runs in containers.
- **1-click infra on Render** — a single Blueprint stands up web, API, workers, Redis, and Postgres. (You still bring your own LLM keys and OAuth credentials.)

## Architecture Overview

[Diagram: Frontend ↔ Gateway (SSE) ↔ Redis (Streams + Pub/Sub) ↔ Worker ↔ Sandbox, with Postgres beneath Gateway and Worker]

Five services, one job each:

- **Web (Next.js).** Renders the chat UI, consumes SSE, posts steering events back via REST.
- **Gateway (Hono).** Stateless HTTP layer. Owns auth, the SSE endpoint, and the inbound webhook handlers.
- **Worker (Bun + Node).** Pulls jobs off Redis Streams and runs the agent loop. Horizontally scalable; each worker caps itself at `MAX_CONCURRENT_RUNS`.
- **Sandbox (Bun HTTP).** A shared execution environment. One service, many sessions, namespaced by directory.
- **Redis.** The nervous system. Job queue (`Streams + consumer groups`), event bus (`Pub/Sub`), ephemeral coordination keys (abort flags, steering queues, heartbeats).
- **Postgres.** Durable everything: sessions, chats, messages, runs, observability events. The source of truth when Redis is just the wire.

Two flows worth holding in your head as you read:

1. **A user sends a message.** Gateway writes the chat row to Postgres, `XADD`s a job onto `agent:jobs:stream`, returns 202. A worker picks up the job, runs `agentLoop`, emits events to Redis (XADD + PUBLISH). The web client's SSE subscription receives those events live and renders them.
2. **A worker crashes mid-run.** The heartbeat stops. Another worker's stale-run reaper notices, marks the run `failed (worker_lost)`, and the user gets a clean terminal frame. Steps already persisted are still there. The user retries with a follow-up; the new turn loads from Postgres and continues.

---

## The Sandbox Model

### The Design Choice: Shared Container, Logical Isolation

One sandbox service handles every session. Isolation is logical, not physical:

- Each session gets a directory at `/workspace/{sessionId}`.
- Every filesystem operation runs through a path validator that confines access to that directory (with symlink hardening).
- All sessions share one Linux user, one PID namespace, one network namespace.

Contrast with Vercel's `open-agents` or E2B, which spin up a fresh VM or microVM per session. Those give you VM-grade isolation at the cost of seconds of cold start, dramatically higher per-session cost, and an extra control plane to operate. For a single team running its own agents against its own code, that trade is bad.

#### Threat Model: What Logical Isolation Does and Doesn't Buy You

Be honest about what's protected:

| Attack                                       | Protected? | Why                                                                |
| -------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| Session A reads session B's files            | Yes        | Path validator + symlink check on every file op.                   |
| Session A reads its own repo's secrets       | N/A        | Out of scope — it's the user's repo and the user's agent.          |
| Session A `kill`s session B's processes      | **No**     | Shared PID namespace; same UID.                                    |
| Session A exhausts host CPU / RAM / disk     | **No**     | No cgroup quotas in the current implementation.                    |
| Session A hits session B's localhost ports   | **No**     | Shared network namespace.                                          |
| Session A exfiltrates LLM API keys           | Partial    | Keys live in the agent process, not the sandbox; `__SECRET__` env values are redacted from tool output before they re-enter the LLM context. |
| TOCTOU between path validate and file open   | Partial    | A post-op `assertRealPathWithinSessionWorkspace` re-checks after the operation; not a full mitigation. |

This is appropriate for **a trusted team running their own code**. It is **not** suitable for hosting untrusted third-party code. If your threat model requires that, swap to per-session containers (see below).

### How It Works

- Bun HTTP server exposing `exec`, file I/O, git, glob, and grep over REST.
- Worker routes every request with an `X-Session-Id` header.
- Bearer token auth between worker and sandbox (this protects the sandbox API from outside callers; it does *not* protect sessions from each other).
- Path validator on every filesystem op.

Path security is the critical piece. Every file operation resolves the path, checks logical containment, and dereferences symlinks before allowing the op:

```typescript
export function validatePath(sessionId: string, filePath: string): string {
  const sessionWs = getSessionWorkspace(sessionId);
  const normalized = filePath.replace(/^\/+/, "");
  const resolved = resolve(join(sessionWs, normalized));

  const underRoot =
    resolved === sessionWs || resolved.startsWith(sessionWs + sep);
  if (!underRoot) {
    throw new Error(`Path traversal attempt detected: ${filePath}`);
  }

  if (existsSync(resolved)) {
    const realRoot = realpathSync(sessionWs);
    const realPath = realpathSync(resolved);
    if (!realPath.startsWith(realRoot + sep)) {
      throw new Error(`Path escapes session workspace (symlink)`);
    }
  }

  return resolved;
}
```

For TOCTOU-sensitive ops the handler calls `assertRealPathWithinSessionWorkspace` again after the syscall, so a symlink swapped in between validate and open is caught before the response is returned.

### Session Lifecycle

- `provision()` doesn't spin up infra. It returns an HTTP adapter pointing at the shared service.
- Workspace setup: clone repos directly, or fan out git worktrees from a shared bare mirror (the bare mirror is the unsung hero of fast multi-repo agent startup — `git clone --reference` for free).
- Teardown is `rm -rf /workspace/{sessionId}`. No container lifecycle overhead.

The provider itself is a cached HTTP client with a 10-minute TTL and a self-heal on failure — if a `provision` throws (stale connection, DNS blip), we rebuild and retry once:

```typescript
let _sandboxProvider: SandboxProvider | null = null;
let _sandboxProviderCreatedAt = 0;
const SANDBOX_PROVIDER_MAX_AGE_MS = 10 * 60 * 1000;

function getSandboxProvider(): SandboxProvider {
  const now = Date.now();
  if (_sandboxProvider && now - _sandboxProviderCreatedAt < SANDBOX_PROVIDER_MAX_AGE_MS) {
    return _sandboxProvider;
  }
  _sandboxProvider = buildSharedHttpProvider();  // reads SANDBOX_SERVICE_HOST, secrets, session auth
  _sandboxProviderCreatedAt = now;
  return _sandboxProvider;
}

export async function getAdapter(sessionId: string): Promise<SandboxAdapter> {
  try {
    return await getSandboxProvider().provision(sessionId);
  } catch {
    _sandboxProvider = null;            // force rebuild on next call
    _sandboxProviderCreatedAt = 0;
    return getSandboxProvider().provision(sessionId);
  }
}
```

### Scaling on Render

- Sandbox: Docker web service with a persistent disk (default 20 GB, shared across all sessions — quota enforcement is a TODO).
- Workers scale independently. Each worker caps itself at `MAX_CONCURRENT_RUNS` (default 10) via the simplest possible "semaphore" — a counter checked in the read loop:

```typescript
while (true) {
  if (shuttingDown && active === 0) break;
  if (shuttingDown) { await sleep(100); continue; }
  if (active >= MAX_CONCURRENT) { await sleep(100); continue; }

  const entry = await readOneJob(redis, WORKER_ID, BLOCK_READ_MS);
  if (!entry) continue;

  active++;
  void processJob(redis, entry.streamId, entry.job, platform)
    .finally(() => { active--; });
}
```

Three additional loops run in parallel: a heartbeat (so other workers know we're alive), a `reclaimStalePending` loop that grabs jobs from dead workers via Redis Streams' `XAUTOCLAIM`, and a stale-run reaper that finalizes runs whose heartbeats stopped. Together they make worker crashes a non-event — a new worker picks up where the old one died.

Blueprint wires it all together — one `render.yaml` stands up web, gateway, worker, sandbox, Redis, and Postgres.

### Future: Per-Session Isolation

When you outgrow logical isolation — hosting third-party code, regulatory pressure, untrusted automations — the adapter pattern makes the upgrade a swap. `SharedHttpSandboxProvider` becomes `FirecrackerProvider` (or gVisor, or per-session containers via the Render API). The worker doesn't know the difference. The cost goes up; the cold start goes up; the blast radius shrinks to a single VM.

That's a deliberate "do this when you need to" path, not a "do this from day one" requirement.

---

## Data Model and Persistence Strategy

### Why Not Pure Event Sourcing?

Agent sessions *look* like the textbook event-sourcing use case: append-only stream of facts, deterministic projections, perfect audit log. We considered it and rejected it. The honest reasons:

- **Operational simplicity.** Snapshots, projections, schema migrations on event payloads — ES is a whole infrastructure to operate. We wanted to ship an agent platform, not an ES platform.
- **The chat UI needs random access.** "Render message 47 with its tool calls expanded" is a SELECT, not a replay.
- **The LLM context is itself a derivation.** It's already a projection of the message log into a provider-specific shape. Storing the projection alongside the source means we don't recompute it on every turn.

So the platform uses a hybrid: durable CRUD for things you read, append-only for things you observe, ephemeral Redis for things in flight.

### The Core Schema

- `sessions` — workspace binding, lifecycle phase, active skills, git stats.
- `chats` → `chat_messages` — durable chat history. **Each message stores two representations**, by design:
  - `parts` — the rich UI rendering (text blocks, tool-call cards, plan widgets, code diffs).
  - `model_messages` — the canonical LLM-shaped messages used to build context for the next turn.
- `agent_runs` — one row per turn, with the lifecycle state machine attached.
- `agent_events` — append-only span log for everything observable.

#### Why two representations per message?

This is the highest-bug-density area of any chat-with-tools app, and it's worth being explicit about the choice. We could store one shape and derive the other; we chose to store both, with one write path and one canonical source.

- The agent loop is the single writer for both. After every step, both `parts` and `model_messages` are upserted together, keyed by `(chatId, sequence)`.
- The UI never reads `model_messages`. The next-turn builder never reads `parts`.
- Compaction (replacing stale tool results with pointers) mutates `model_messages` only — it must not change what the user already saw rendered in `parts`.

Storing both makes the UI snappy (one read, no transformation) and makes context construction explicit (no "is this an assistant text block or a tool result?" disambiguation at request time). The cost is that the writer has one job: produce both shapes from the same step output, atomically.

### The Run State Machine

Runs move through a small state space, with all transitions centralized:

```
queued ──► running ──► completed
              │   ├──► failed
              │   └──► aborted (user_stop | timeout | worker_lost)
              └──► (heartbeat stale > 5min) ──► failed (worker_lost)
```

The stale-run reaper (see Workers, above) is what makes `worker_lost` automatic — no human in the loop, no stuck "running" rows. Every terminal state stores a `terminalReason` so the UI and observability layer can tell the user *why* their run ended.

### Incremental Persistence

After every step, the assistant message is upserted to `chat_messages`. Keyed by `(chatId, sequence)` — the same step always writes to the same row.

This is the architectural difference from event sourcing: state is written eagerly, not derived from a log. If the worker crashes at step 15, steps 1–14 are already durable. The user sends a follow-up; the new turn loads the messages from Postgres and continues. No replay, no reconciliation.

In-flight tool calls (e.g., a `bash` that was running when the worker died) are reconciled at run finalization: the run is marked `failed` with `terminalReason = worker_lost`, the assistant message persists with whatever partial state exists, and the next turn starts fresh.

### The Observability Layer (Append-Only)

`agent_events` is a separate beast. It's never used to reconstruct state — only for analytics, cost tracking, and debugging:

- Span tree built from `parentEventId`: `llm_request → tool_call → sandbox_exec`.
- Capped at 10,000 events per run (drop after that; warn at 80%).
- Range-partitioned by month; the retention job drops whole partitions older than 30 days.
- Token counts and estimated USD cost live in `metadata` JSONB for direct aggregation.

The 30-day rolling window is a real trade. Historical cost trends past 30 days have to come from somewhere — we punt to a rollup table when you need it, but it's not built today. Mark it on your roadmap if you intend to track quarter-over-quarter spend.

### Tradeoffs

- **Pro:** Simple reads, no replay, familiar CRUD for most queries.
- **Pro:** Observability is fully separable — drop the table, the agent still works.
- **Con:** Two representations of "what happened" (messages vs events) that must stay in sync conceptually. The discipline is: messages are the source of truth for state, events are the source of truth for *why*.
- **Con:** No time-travel replay. You can't rewind to step 3 and re-run with a different model.

---

## Streaming Architecture: Redis Streams + SSE

### The Problem

- LLM tokens arrive one at a time; tool outputs are async and interleaved.
- The frontend needs sub-second rendering and reconnect resilience.
- Multiple clients may watch the same session at once (the user has two tabs open).
- The agent can outlive the connection — start the run on desktop, finish it on phone.

### Redis as the Nervous System — Two Streams + One Pub/Sub

1. **Job queue** — `agent:jobs:stream` with a consumer group `agent-workers`. At-least-once delivery, dead-letter on max retries.
2. **Event stream** — `run:{runId}:events`, capped at ~2000 entries with a 24h TTL. This is the replay buffer for reconnecting clients.
3. **Pub/Sub** — `run:{runId}` channel for push. Zero persistence; if you weren't subscribed you missed it.

The worker dual-writes every event: `XADD` for durability, `PUBLISH` for push.

```typescript
export async function publishRunEvent(
  redis: Redis,
  runId: string,
  payloadJson: string,
): Promise<void> {
  const key = `run:${runId}:events`;

  const streamId = await redis.xadd(key, "MAXLEN", "~", "2000", "*", "e", payloadJson);

  try {
    const pubPayload = JSON.stringify({ _sid: streamId, ...JSON.parse(payloadJson) });
    await redis.publish(`run:${runId}`, pubPayload);
  } catch (err) {
    // XADD succeeded — clients will catch up via XRANGE on reconnect
    console.error("[run-stream] PUBLISH failed (XADD succeeded)", { runId, streamId, err });
  }
}
```

The stream ID is embedded in the pub/sub payload as `_sid`. That single field is what makes reconnect-with-deduplication tractable.

### What Happens When the Stream Cap is Exceeded

The 2000-entry cap is a real ceiling. A long-running session that emits 5000 events loses the oldest 3000 from `XRANGE`. Clients reconnecting with `Last-Event-ID = <evicted-id>` cannot resync from Redis alone.

The platform handles this with a layered fallback:

- **Live clients** see everything via pub/sub. The cap only matters on reconnect.
- **Recent reconnects** (within the 2000-event window) replay from Redis Streams.
- **Cold loads or deep reconnects** hydrate from Postgres. The `chat_messages` table holds the canonical history; the stream is only an acceleration layer. Page-load goes through `chat_messages`, not `XRANGE`.

The contract is: Redis is the live nervous system, Postgres is the ground truth. The stream cap doesn't lose data — it loses fast-reconnect ergonomics for very long sessions.

### SSE Endpoint Design

The endpoint does five things in order, and the order matters.

1. Subscribe to pub/sub *first*, buffering messages into memory.
2. Replay history from Redis Streams (or from `Last-Event-ID`).
3. Flush the buffer, deduplicating any entry whose stream ID we already replayed.
4. Swap the buffering handler for a live writer — and unsubscribe the original.
5. Close on terminal event or client disconnect.

The subscribe-first-then-replay ordering is what closes the race window where a pub/sub event arrives after we read history but before we go live.

```typescript
streamRoutes.get("/sessions/:id", async (c) => {
  // ... auth and lookup elided ...

  // Step 1 — subscribe FIRST, buffering everything
  const pubsubBuffer: { sid: string | null; payload: string }[] = [];
  let draining = false;
  let sub = await subscribeToRun(runId, (message) => {
    if (draining) return;
    pubsubBuffer.push({ sid: parseSid(message), payload: message });
  });

  // Step 2 — read history (from Last-Event-ID, or beginning)
  const historyEntries = lastEventId
    ? (await readRunEventEntriesAfterId(cmd, runId, lastEventId)).entries
    : (await readRunEventHistoryDetailed(cmd, runId)).entries;
  const lastHistoryId = historyEntries.at(-1)?.id ?? lastEventId;

  return streamSSE(c, async (stream) => {
    // Step 3 — replay
    for (const entry of historyEntries) {
      await stream.writeSSE({ id: entry.id, data: entry.payload });
    }

    // Step 4 — drain buffered pub/sub, deduping against history
    draining = true;
    for (const buf of pubsubBuffer) {
      if (buf.sid && lastHistoryId && buf.sid <= lastHistoryId) continue;
      await stream.writeSSE({ id: buf.sid ?? undefined, data: buf.payload });
    }

    // Step 5 — swap to live writer, unsubscribe the buffering handler
    const liveSub = await subscribeToRun(runId, (message) => {
      stream.writeSSE({ id: parseSid(message), data: message }).catch(() => {});
      if (isTerminal(message)) cleanup();
    });
    await sub.unsubscribe();
    sub = liveSub;

    // ... keep-alive ping + abort plumbing ...
  });
});
```

A few details that matter:

- **Why two `subscribeToRun` calls and not one?** The buffering callback needs to be a different function than the live writer (one pushes to an array, one writes to the response). The handoff happens with the `draining` flag plus explicit `unsubscribe` of the original — no leak.
- **Why does `buf.sid <= lastHistoryId` work?** Redis stream IDs are `<ms>-<seq>` strings that sort lexicographically the same way they sort temporally, because the millisecond component is monotonic. The string comparison is correct and intentional.
- **Synthetic terminal frame.** If the run already finished and no terminal event is in the stream (because it was evicted), the endpoint checks `run:{runId}:status`, fabricates a terminal frame, and closes. The client sees a clean end instead of hanging.
- **Shared subscriber.** Multiple watchers of the same run share one Redis subscription. The gateway maintains a fan-out map keyed by channel.

### Why SSE Over WebSockets

The right argument isn't "unidirectional is sufficient" — steering events do flow upstream. The right argument is asymmetry: downstream is high-frequency tokens that need free reconnect and `Last-Event-ID` resumption; upstream is rare, idempotent steering commands that fit naturally as REST POSTs. SSE + REST gives us the right tool for each direction; WebSockets would force a custom resume protocol on top of a bidirectional channel we don't need.

### Event Envelope (v2)

`{ v: 2, type, ts, requestId?, payload }`. Types include `agent:message`, `agent:tool_call`, `agent:tool_result`, `agent:heartbeat`, `user:message`, `user:interrupt`, `session:completed | failed | aborted`. The `v` prefix exists so we can ship v3 next year without breaking old clients in the middle of a run.

### Steering: User Input Mid-Run

When the user types "actually, also fix the tests" while the agent is running, that input goes through a separate channel:

```typescript
export async function publishSteeringEvent(
  redis: Redis,
  runId: string,
  event: { type: string; content?: string; reason?: string },
): Promise<void> {
  const payload = JSON.stringify({ ...event, ts: new Date().toISOString() });

  await redis.rpush(`run:${runId}:steering:queue`, payload);
  await redis.expire(`run:${runId}:steering:queue`, 3600);

  // Also publish for any future "instant notify" subscribers
  // (currently unused by the agent — see note below)
  await redis.publish(`run:${runId}:steering`, payload);
}
```

The agent drains the list between steps. The pub/sub call is intentionally future-facing — no consumer subscribes to it today. The design leaves a hook for an "agent is woken immediately mid-tool" mode without changing the publisher contract.

The current model is: steering is processed at step boundaries; `user:interrupt` flows through the abort controller for immediate stop during a tool call.

### Frontend Consumption

- `useEventSource` hook with exponential-backoff reconnect (max 5 attempts).
- Events are reduced through `chatReducer` — incremental UI updates, never a full re-render.
- Token streaming: partial assistant message chunks are appended in place; tool-call cards collapse and expand as their `tool_use` and `tool_result` events arrive.

---

## The Agent Loop

This is the heart of the system. Everything else exists to keep this loop running, observable, and recoverable.

### The Core Loop: Simple by Design

The inner loop is ~300 lines. Deliberately minimal — no plugin system, no middleware chain, no event emitter pattern. Just an LLM call, tool execution, message accumulation, repeat. Complexity in this loop is invisible complexity: when the agent does something surprising at step 47, you need to trace exactly what happened, and every abstraction here costs you debuggability.

The shape, stripped to the essentials:

```typescript
export async function agentLoop(params: {
  provider: LLMProvider;
  model: string;
  system: string;
  messages: LLMMessage[];
  tools: Map<string, AgentTool>;
  maxSteps: number;
  signal?: AbortSignal;
  onStep?: (step: AgentStep) => Promise<void>;
  shouldAbort?: () => Promise<boolean>;
  onSteeringCheck?: () => Promise<{ messages: Array<{ type: string; content?: string }> }>;
  onToken?: (token: string) => void;
  resultStore?: Map<string, string>;
  recorder?: ObservabilityRecorder;
  secrets?: Record<string, string>;
}): Promise<AgentLoopResult> {
  const allMessages = [...params.messages];

  while (steps < maxSteps) {
    if (await shouldAbort()) break;

    // 1. Compact stale tool results (token efficiency)
    compactStaleToolResults(allMessages, resultStore, steps);

    // 2. Call the LLM (with retry)
    const response = await chatWithRetry(provider, {
      model, system, messages: allMessages, tools: toolDefs, signal, onToken,
    });

    // 3. No tool calls? We're done.
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    if (toolUseBlocks.length === 0) {
      terminationReason = "end_turn";
      break;
    }

    // 4. Execute each tool call sequentially
    allMessages.push({ role: "assistant", content: response.content });
    const resultBlocks: ContentBlock[] = [];
    for (const block of toolUseBlocks) {
      const tool = tools.get(block.name);
      const output = await tool.execute(block.input, block.id, { signal });
      resultBlocks.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: formatToolOutputForLlm(output, secrets),  // Redact secrets
      });
    }
    allMessages.push({ role: "user", content: resultBlocks });

    // 5. Persist + stream after each step
    await onStep({ text, toolCalls, toolResults, usage: response.usage });

    // 6. Check for user steering (inject messages, interrupt)
    const steering = await onSteeringCheck();
    for (const msg of steering.messages) {
      if (msg.type === "user:interrupt") { terminationReason = "abort"; break; }
      if (msg.type === "user:message") allMessages.push({ role: "user", content: msg.content });
    }
  }

  return { text, messages: allMessages, totalUsage, steps, terminationReason };
}
```

### Context Management: The Hard Problem
- Every loop iteration, the full message history goes back to the LLM. Context windows are large but not infinite. You're paying per token. How do you keep costs down without losing critical information?

#### Tool Result Compaction
- The key insight: tool results are huge (file contents, grep output, build logs) but most of them become irrelevant after 2 steps.
- Strategy: after step N, any tool result from step N-2 or earlier that exceeds 2000 chars gets replaced with a compact pointer.
- Full content stored in a `Map<string, string>` (the result store), retrievable by the agent via a dedicated `get_tool_result` tool.
- This is lazy eviction — the agent can still access anything it needs, but the LLM context stays lean.

```typescript
const COMPACTION_CHAR_THRESHOLD = 2000;
const COMPACTION_STALE_STEPS = 2;

function compactStaleToolResults(
  allMessages: LLMMessage[],
  resultStore: Map<string, string>,
  currentStep: number,
): void {
  let stepCounter = 0;
  const cutoffStep = currentStep - COMPACTION_STALE_STEPS;

  for (const msg of allMessages) {
    if (msg.role === "assistant") {
      if (msg.content.some((b) => b.type === "tool_use")) stepCounter++;
    }
    if (msg.role !== "user" || stepCounter > cutoffStep) continue;

    for (const block of msg.content) {
      if (block.type !== "tool_result" || block.is_error) continue;
      const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
      if (content.length < COMPACTION_CHAR_THRESHOLD) continue;

      // Store full content, replace with pointer
      resultStore.set(block.tool_use_id, content);
      const firstLine = content.slice(0, 100).split("\n")[0];
      const approxLines = content.split("\n").length;
      block.content = `[Compacted: ${approxLines} lines. Preview: "${firstLine}…". Use get_tool_result("${block.tool_use_id}") to retrieve.]`;
    }
  }
}
```

The tradeoff: the model might not realize it needs old context. In practice, the preview line + tool name is enough for the model to decide whether to page it back in.

#### Secret Redaction
- Tool outputs often contain secrets (API keys in env files, tokens in config). These must never enter the LLM context.
- Pattern: `__SECRET__`-prefixed env vars are stripped from all tool output before it enters messages.
- Applied uniformly via `formatToolOutputForLlm()` — a single chokepoint for all tool results.

```typescript
export function redactSecrets(text: string, secrets: Record<string, string>): string {
  if (!text || Object.keys(secrets).length === 0) return text;
  let result = text;
  for (const [key, value] of Object.entries(secrets)) {
    if (!key.startsWith("__SECRET__") || !value) continue;
    result = result.replaceAll(value, `[REDACTED:${key.replace("__SECRET__", "")}]`);
  }
  return result;
}

export function formatToolOutputForLlm(output: unknown, secrets?: Record<string, string>): string {
  const serialized = typeof output === "string" ? output : JSON.stringify(output);
  if (!secrets) return serialized;
  return redactSecrets(serialized, secrets);
}
```

### Sub-agents: Divide and Conquer
- The `task` tool spawns a nested `agentLoop` with a reduced tool set, configurable model, and hard step cap.
- Results are summarized back to the parent — the parent never sees the sub-agent's internal steps.
- When to delegate: parallelizable or isolated work (write tests, refactor a file, research a question).

```typescript
const MAX_SUBAGENT_STEPS = 20;

export function taskTool(publishFn, buildSubTools, modelResolver, forgeContext, parentSignals) {
  return defineTool({
    description: "Delegate a self-contained subtask to a focused subagent.",
    inputSchema: z.object({
      task: z.string(),
      context: z.string().optional(),
      model: z.string().optional(),  // Agent can request a specific model
    }),
    execute: async ({ task, context, model: requestedModel }) => {
      const { provider, modelId } = modelResolver.resolve(requestedModel);
      const subTools = buildSubTools();  // Core tools only — no `task` (no recursion)

      const result = await agentLoop({
        provider,
        model: modelId,
        system: "You are a focused subagent completing a specific task.",
        messages: [{ role: "user", content: task }],
        tools: subTools,
        maxSteps: MAX_SUBAGENT_STEPS,
        signal: parentSignals?.signal,      // Shared abort
        recorder: parentSignals?.recorder,  // Shared observability
        secrets: parentSignals?.secrets,    // Shared redaction
        resultStore: parentSignals?.resultStore,
      });

      return { success: true, result: result.text };
    },
  });
}
```

The model resolver defaults to a cheaper model (Haiku) for routine work, but the parent agent can escalate:
```typescript
const SUBAGENT_DEFAULT_MODEL = process.env.SUBAGENT_DEFAULT_MODEL ?? "anthropic/claude-haiku-4-5";
```

### Resilience Patterns

#### Retry with Exponential Backoff

LLM calls are retried up to 3 times for transient errors (429, 5xx, network failures). Backoff is `1s → 4s` before the final attempt (which throws without delay).

```typescript
const LLM_MAX_RETRIES = 3;
const LLM_RETRY_BACKOFF = [1000, 4000];   // 3 attempts, 2 backoffs

function isTransientLlmError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("429") || msg.includes("rate limit") || msg.includes("overloaded") ||
    msg.includes("500") || msg.includes("502") || msg.includes("503") || msg.includes("529") ||
    msg.includes("network") || msg.includes("econnreset") || msg.includes("timeout")
  );
}

async function chatWithRetry(provider: LLMProvider, chatParams): Promise<LLMResponse> {
  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    try {
      return await provider.chat(chatParams);
    } catch (err) {
      if (!isTransientLlmError(err) || attempt === LLM_MAX_RETRIES - 1 || chatParams.signal?.aborted) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, LLM_RETRY_BACKOFF[attempt]));
    }
  }
}
```

A note on jitter: at `MAX_CONCURRENT_RUNS=10`, ten in-flight runs hitting Anthropic during a regional 529 will retry in lockstep. Jitter is cheap and on the list of things to add — call it out as a known limitation. If you're tuning this for higher concurrency, add jitter and consider provider fallback.

#### Empty Response Handling
- LLMs sometimes return empty responses (no text, no tool calls). Rather than failing, retry up to 2 times silently.
- If still empty after retries, terminate gracefully with reason `empty_response`.

#### Abort and Timeout

Two abort mechanisms merged into a single `AbortController`:

1. **User-initiated stop** — Redis key `run:{runId}:abort`, polled every 500ms.
2. **Turn timeout** — fires after 10 minutes (configurable).

Both propagate through the same signal. Tools respect `signal.aborted` and bail cleanly. The abort poll loop is a deliberate trade — 2 RPS per concurrent run against Redis is cheap relative to the per-step latency. A subscription would be tighter but adds another connection per run; we may move there as concurrency scales.

```typescript
export function createMergedAbortController(
  events: EventBus,
  runId: string,
  timeoutMs: number,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("Turn timeout", "TimeoutError"));
    }
  }, timeoutMs);

  const pollInterval = setInterval(async () => {
    try {
      const val = await events.getKey(`run:${runId}:abort`);
      if (val === "1" && !controller.signal.aborted) {
        controller.abort(new DOMException("User stopped", "AbortError"));
      }
    } catch {}
  }, 500);

  return { controller, cleanup: () => { clearTimeout(timeout); clearInterval(pollInterval); } };
}
```

#### Incremental Persistence

Already covered in §Data Model. Worth restating because it's load-bearing for resilience: every step upserts the assistant message to Postgres, so a crash at step 15 keeps steps 1–14 intact. The next turn loads from `chat_messages` and continues. No replay, no reconciliation.

### Steering: Human-in-the-Loop Mid-Run

The agent isn't a black box you wait on. Between steps the loop checks a Redis list for "steering events" — messages the user injected while the agent is working.

- `user:message` → appended to the message history; the agent sees it on the next LLM call.
- `user:interrupt` → terminates the run with reason `abort`.

`user:interrupt` *also* gets written to `run:{runId}:abort`, so the merged abort controller stops in-flight tool calls within ~500ms even if the agent is mid-`bash`. The list-poll path handles step boundaries; the abort-key path handles immediate stop. Same signal, two latencies.

```typescript
// Inside agentLoop, after each step's tool execution:
const steering = await onSteeringCheck();
for (const msg of steering.messages) {
  if (msg.type === "user:interrupt") {
    terminationReason = "abort";
    break;
  }
  if (msg.type === "user:message" && msg.content) {
    allMessages.push({ role: "user", content: msg.content });
  }
}
```

The queue is drained atomically — `LRANGE` then `DEL` — so concurrent steers never get lost or processed twice.

### Token Economics

- Every step logs input, output, cache-creation, and cache-read tokens.
- Anthropic prompt caching is on by default: the system prompt and early messages cost ~0 after the first call.
- Step limit (default 100) prevents runaway cost. Most turns finish in 5–15 steps.
- Sub-agents default to a cheaper model (Haiku) for routine work — the parent can escalate when needed.
- A typical "implement a small feature across 3 files" turn lands around **$0.10–$0.30** with Sonnet + Haiku sub-agents and warm prompt cache. Greenfield "build me X" turns scale linearly with output volume.

There is no per-run USD ceiling today — only a step ceiling. If you care about absolute cost bounds for production deployments, add one.

### What We'd Do Differently

- **Parallel tool execution.** Today sequential. Independent calls (`read_file` + `glob` + `grep`) could run concurrently. At ~200ms each that's real latency.
- **Smarter compaction.** Current strategy is purely positional (age-based). A semantic strategy — compact what the model hasn't referenced — would be more accurate.
- **Streaming tool results.** Tools like `bash` and build commands produce incremental output. Today we wait for completion. Streaming would shave seconds off long builds in the UI.
- **Provider fallback.** A persistent Anthropic outage past the retry budget fails the run. Falling back to OpenAI or Gemini is a small `modelResolver` extension.
- **Per-run cost ceilings.** Step caps protect against runaway loops but not runaway tokens.

## Automations and Integrations

> **Status note.** The GitHub-event path described here ships today via the `InboundRouter`. The generalized automation engine — cron triggers, multi-source adapters, the `automations` entity, BugBot as a configurable template — is **designed but not yet implemented**. The architecture section below is the spec we're building against; the "What's Built Today" subsection at the end is what's actually live.

### The Vision: Agents That Fire Themselves

Everything above requires a human to start a session. The real leverage of coding agents shows up when they run autonomously — triggered by events in your workflow:

- A PR is opened → an agent reviews the code and posts inline comments (BugBot)
- A cron tick at 9am Monday → an agent audits dependencies for new vulnerabilities
- A Linear issue is assigned to `agent-bot` → an agent implements the feature
- A Slack message mentions "@agent fix the flaky test" → an agent investigates and pushes a fix

The automation engine binds **triggers** to **agent configurations** — "when X happens, spawn an agent with prompt Y, tools Z, targeting repos R."

### Architecture: Extending the Event Pipeline

The key insight: we already have an event-driven inbound pipeline (`InboundRouter` → `InboundDispatcher` → Redis Streams → Worker). Automations don't replace this — they plug into it as a new consumer:

```
External Event (GitHub webhook, Slack event, cron tick, Linear webhook)
    │
    ▼
InboundRouter (normalize to canonical InboundEvent format)
    │
    ▼
AutomationMatcher (event → which automations match?)
    │
    ▼
For each match: create session via existing job queue
    │
    ▼
Worker picks up job → agentLoop() (same path as manual sessions)
```

This means automations get observability, streaming, crash recovery, and all other infrastructure for free. No special execution path.

### The Automation Entity

```typescript
// Core table: the trigger-to-agent binding
automations: {
  id, orgId, userId, name, description,
  enabled,                          // pause/resume without deleting
  triggerType,                      // 'cron' | 'github_event' | 'slack_message' | 'linear_issue' | 'webhook'
  triggerConfig: jsonb,             // polymorphic config per trigger type
  prompt,                           // template sent to the agent
  modelId,                          // LLM override (null = org default)
  activeSkills,                     // skills to load
  maxConcurrentRuns,                // prevent runaway parallel sessions
  coalesceWindowMs,                 // dedup rapid-fire events (e.g. 50 pushes in 60s)
  nextRunAt,                        // for cron triggers — pre-calculated
  lastRunAt, lastRunStatus, runCount,
  healthStatus, healthMessage,      // credential expiry, repeated failures
}
```

### Trigger Types

#### Cron / Scheduled
```json
{ "expression": "0 9 * * 1", "timezone": "America/New_York" }
```
- Scheduler polls a Redis ZSET (`automation:schedule`) scored by `nextRunAt`
- On tick: emit `scheduled_tick` event, advance `nextRunAt` to next occurrence
- Overdue ticks skip to next future occurrence (no batch-firing missed runs)
- Scheduler runs inside the agent worker process (no new service needed)

#### GitHub Events
```json
{
  "events": ["pr_opened", "pr_synchronize"],
  "filters": { "branch": "main", "actor_exclude": ["dependabot[bot]"] }
}
```
- Extends existing GitHub webhook handler
- Condition filters: target branch, workflow name, path pattern, actor exclusion
- Multiple automations can match the same event (each creates independent session)

#### Slack Messages
```json
{
  "credential_id": "cred_xxx",
  "channel_ids": ["C012345"],
  "match": { "keywords": ["agent", "fix"], "mention_bot": true }
}
```
- Slack Events API via OAuth workspace connection
- Keyword matching + channel scoping
- Credential health monitoring (flags automation if token expires)

#### Linear Issues
```json
{
  "events": ["issue_assigned", "label_added"],
  "filters": { "assignee": "agent-bot", "labels": ["auto-implement"] }
}
```
- Linear webhook integration
- Assign issue to agent → automation fires with issue context as prompt
- Bidirectional: agent updates Linear issue status as work progresses

### Deduplication and Coalescing

Rapid-fire events are a real problem. 50 pushes to a PR in 2 minutes shouldn't spawn 50 agent sessions. The engine handles this two ways:

- **Coalesce window** (configurable per automation, default 60s) collapses bursts.
- **Dedup key by content.** For PR events the key includes the latest commit SHA. If a session is already in flight for the same SHA, the new event is a no-op. If the SHA has advanced, the prior session is cancelled and a fresh one starts with the latest context — so commits landing between abort and restart aren't lost.

### BugBot: The Flagship Automation

BugBot is a pre-built automation template that validates the engine end-to-end:

1. Triggers on PR opened / synchronize.
2. Loads the PR diff + repo's `.cursor/BUGBOT.md` review rubric.
3. Runs a specialized review prompt with a constrained tool set (`read_file`, `glob`, `grep`, `post_pr_comment`).
4. Posts inline PR comments with findings, optionally spawning a follow-up "autofix" subagent.

It's "just" an automation with a focused prompt and a focused tool set. Anyone can build something similar — that's the point of the template.

### The Adapter Pattern: Adding New Event Sources

Adding a new trigger source (Jira, PagerDuty, custom webhook) takes three things:

1. A **normalizer**: `rawEvent → InboundEvent` (canonical format).
2. A **trigger condition schema**: what fields can be filtered on.
3. A **webhook endpoint** in the gateway with signature verification.

No changes to the router, matcher, dispatcher, or agent execution path. This is what "pluggable architecture" buys you.

### What's Built Today

Just so the line is clear: the GitHub webhook handler that routes PR events into the agent runs in production. The generalized scheduler, matcher, multi-source adapters, and `automations` entity are designed (this section is the design doc) and are the next chunk of work.

---

## Observability

### Why Observability Is Non-Negotiable for Agents

Agents are non-deterministic, multi-step, and long-running. When an agent makes a bad decision at step 23, you can't reproduce the issue by re-running the same input — the LLM may do something different next time. You need a complete, queryable record of every decision, every tool call, and every failure.

This isn't just for debugging. It's for:
- **Cost tracking** — knowing which models and sessions are burning tokens
- **Performance** — finding slow tool calls, retries, and timeouts
- **Trust** — letting users understand *why* the agent did what it did
- **Compliance** — audit trail of all code changes and their provenance

### The Architectural Choice: Lightweight Custom OTel, Not the Full SDK

We deliberately avoided the full `@opentelemetry/sdk-node` auto-instrumentation stack. Here's why:

1. **The SDK is heavy.** Auto-instrumentation hooks into every HTTP call, every DB query, every `setTimeout`. For an agent worker, 95% of that noise is irrelevant — you care about LLM calls and tool executions, not internal Redis pings.

2. **Agent spans don't map cleanly to HTTP spans.** A single agent turn can last 10 minutes and contain 50+ tool calls. The OTel SDK's assumptions about request/response lifecycles don't fit.

3. **We need dual-write.** Events go to both Postgres (for the built-in dashboard) and OTLP (for external backends). The SDK only targets one exporter pipeline.

Instead, we built a ~360-line `ObservabilityRecorder` class that:
- Records structured events to Postgres (batched, 500ms flush)
- Optionally exports OTLP/HTTP JSON spans to any compatible backend
- Manages its own lifecycle (cap, sanitization, credential redaction)

The recorder is instantiated per-run and wired into the agent loop:

```typescript
const recorder = new ObservabilityRecorder({
  platform,
  sessionId: job.sessionId,
  runId: job.runId,
  userId: job.userId,
});
```

### The Span Model: One Trace Per Run

Every agent run gets a single trace ID. Within that trace, spans nest naturally:

```
Trace: run_abc123
├── llm_request (step 1)
│   ├── tool_call: bash
│   │   └── sandbox_exec: bash
│   ├── tool_call: read_file
│   │   └── sandbox_exec: read_file
│   └── tool_call: write_file
│       └── sandbox_exec: write_file
├── llm_request (step 2)
│   └── tool_call: grep
│       └── sandbox_exec: grep
└── system: run_terminated
```

This maps directly to what you'd want to see in Jaeger or Honeycomb: a waterfall view of the entire agent turn, with timing for each LLM call and tool execution.

The span construction converts each completed event into the OTLP wire format:

```typescript
private pushSpan(eventRow: NewAgentEventInput): void {
  if (!this.otlpExporter || !eventRow.endedAt) return;

  const attributes = flattenAttributes(eventRow.metadata ?? {});
  this.spans.push({
    id: toSpanId(eventRow.id),
    traceId: this.traceId,
    parentId: eventRow.parentEventId ? toSpanId(eventRow.parentEventId) : undefined,
    name: eventRow.eventType,
    startTimeUnixNano: toUnixNano(eventRow.startedAt),
    endTimeUnixNano: toUnixNano(eventRow.endedAt),
    attributes,
    statusCode: eventRow.status === "error" ? "STATUS_CODE_ERROR" : "STATUS_CODE_OK",
    statusMessage: eventRow.status === "error" ? "event failed" : undefined,
  });
}
```

### The OTLP Exporter: 87 Lines, Zero Dependencies

Rather than pulling in the full OTel SDK, we hand-build the OTLP/HTTP JSON payload. The entire exporter is ~87 lines:

```typescript
async exportBatch(spans: OtlpSpanEvent[]): Promise<void> {
  if (spans.length === 0) return;

  const payload = {
    resourceSpans: [{
      resource: {
        attributes: [{ key: "service.name", value: { stringValue: this.serviceName } }],
      },
      scopeSpans: [{
        scope: { name: "agent-observability" },
        spans: spans.map((span) => ({
          traceId: span.traceId,
          spanId: span.id,
          parentSpanId: span.parentId ?? undefined,
          name: span.name,
          startTimeUnixNano: span.startTimeUnixNano,
          endTimeUnixNano: span.endTimeUnixNano,
          attributes: span.attributes.map((attr) => ({
            key: attr.key,
            value: this.toOtlpAttributeValue(attr.value),
          })),
          status: { code: span.statusCode, message: span.statusMessage },
        })),
      }],
    }],
  };

  await fetch(this.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...this.headers },
    body: JSON.stringify(payload),
  });
}
```

This works with Jaeger, Grafana Tempo, Honeycomb, Datadog — anything that accepts OTLP/HTTP. No vendor lock-in.

### The Postgres Side: Built-In Dashboard Without External Infra

Not everyone wants to run Jaeger. The `agent_events` table serves as a built-in observability backend:

```typescript
export const agentEvents = pgTable("agent_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  seriesId: integer("series_id").notNull().references(() => eventSeries.id, { onDelete: "cascade" }),
  parentEventId: text("parent_event_id"),
  eventType: text("event_type", { enum: OBSERVABILITY_EVENT_TYPES }).notNull(),
  status: text("status", { enum: OBSERVABILITY_EVENT_STATUSES }).notNull().default("running"),
  startedAt: timestamp("started_at").notNull(),
  endedAt: timestamp("ended_at"),
  durationMs: integer("duration_ms"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

Key design choices:

- **`parentEventId`** creates a tree structure mimicking span parent/child — enables drill-down from LLM request → tool calls → sandbox execs.
- **`seriesId`** points into a small `event_series` table that normalizes the `(sessionId, eventType)` pair out of every row. Most queries filter by series, so this dramatically reduces index size on the large append-only table.
- **`metadata` as JSONB.** Flexible schema per event type — LLM requests store token counts and model IDs, tool calls store tool name and duration, errors store stack traces. The cost is that aggregations over JSONB fields (`metadata->'tokens'->>'input'`) scan and parse per row; typed columns become worth it at high volume.
- **Monthly partitions.** `agent_events` is range-partitioned by `created_at`. The retention job drops entire partitions older than 30 days, which is orders of magnitude faster than row-by-row deletes.

### Guardrails: Preventing Observability From Becoming a Liability

Observability systems have a paradox: the more you record, the more useful they are — but unbounded recording will eat your disk and leak secrets.

#### Event Cap (Default: 10,000 per run)

```typescript
private canRecordMore(): boolean {
  return this.recordedCount < this.eventCap;
}
```

Once the cap is reached, new events are silently dropped. A warning event is emitted at 80% capacity so you can catch runaway runs before they hit the ceiling.

#### Metadata Size Truncation (4KB per field)

```typescript
function truncateByBytes(input: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(input);
  if (encoded.byteLength <= maxBytes) return input;
  const truncated = encoded.slice(0, Math.max(0, maxBytes - 16));
  const decoded = new TextDecoder().decode(truncated);
  return `${decoded}...[TRUNCATED]`;
}
```

Tool outputs can be huge (entire file contents, build logs). Without truncation, a single `read_file` result would balloon the observability table.

#### Credential Redaction (Two Layers)

**Layer 1: Pattern-based.** Before metadata is stored, `redactCredentials()` scans for known secret patterns (API keys, tokens, passwords) via configurable regexes:

```typescript
export function redactCredentials(text: string, policy: CredentialPermissions): string {
  if (!text || policy.patterns.length === 0) return text;
  let result = text;
  for (const pattern of policy.patterns) {
    try {
      const re = new RegExp(pattern, "g");
      result = result.replace(re, "[REDACTED]");
    } catch { }
  }
  return result;
}
```

**Layer 2: Key-name heuristic.** Any metadata field whose key matches `/(?:^|_)(key|secret|token|password)$/i` gets blanket-redacted. Belt and suspenders — even if upstream redaction fails, the storage layer catches it.

### Usage Analytics: Token Costs From JSONB Queries

Because `llm_request` events store token counts in their metadata, the platform can aggregate cost data directly from Postgres — no external analytics pipeline needed:

```typescript
const rows = await this.db
  .select({
    key: groupExpr,
    inputTokens: sql`coalesce(sum(((metadata->'tokens'->>'input')::int)), 0)`,
    outputTokens: sql`coalesce(sum(((metadata->'tokens'->>'output')::int)), 0)`,
    estimatedCost: sql`coalesce(sum(((metadata->>'estimatedCostUsd')::numeric)), 0)`,
    llmRequestCount: sql`count(*)`,
  })
  .from(agentEvents)
  .where(and(eq(agentEvents.eventType, "llm_request"), /* date filters */))
  .groupBy(groupExpr);
```

Group by model or by session. Know exactly where your tokens are going.

### Batching and Flush Strategy

Events aren't written one at a time. The recorder batches:
- **Flush every 500ms** (timer-based)
- **Or immediately at batch size 20** (count-based)
- **Final flush on `close()`** (end of run)

This keeps write amplification low — a typical 15-step run produces ~45 events, which flush in 2-3 batches rather than 45 individual inserts.

### Connecting to External Backends

Configuration is three env vars:

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://tempo.example.com
OTEL_SERVICE_NAME=coding-agents-prod
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer xxx,X-Scope-OrgID=my-org
```

Set them and spans flow automatically. Don't set them and you still get the Postgres-backed dashboard. Zero coupling.

### What We'd Do Differently

- **Tail-based sampling for high-volume deployments.** Today every event is recorded. At scale you'd sample for OTLP export while keeping Postgres at full fidelity (so cost tracking stays accurate). Tail-based, not head-based — head-based drops errors statistically, which is exactly backwards for an agent platform.
- **Structured-log correlation.** Console logs aren't tied to trace IDs. Wiring `traceId` and `runId` into structured logs would unify the picture.
- **Metrics pipeline.** We export spans but not OTel metrics. Histograms of LLM latency, counters of tool errors, gauges of concurrent runs — all valuable for alerting.
- **Typed columns for token counts.** `(metadata->'tokens'->>'input')::int` works at today's scale; at 10M+ events you'd want a materialized view or generated columns to keep aggregations sub-second.

---

## Closing the Loop on the Cross-Cutting Themes

The intro made three promises against the Cursor/Devin model: **cost, opacity, and lock-in**. Worth tying each back to a concrete piece of the architecture before we close:

- **Cost.** Tool-result compaction with lazy retrieval, cheaper sub-agent models by default, prompt caching on by default, per-step token logging. The result is sub-dollar typical turns and full visibility into where every token went.
- **Opacity.** One trace per run, span tree from LLM request down to sandbox `exec`, Postgres-backed dashboard out of the box, OTLP export to your existing backend if you have one. "Why did the agent do X at step 23?" is a query, not a guess.
- **Lock-in.** Containers everywhere. Render Blueprint for 1-click, Docker for anywhere else. LLM provider abstraction. OTLP export to any backend. Postgres + Redis are the only stateful dependencies. The platform is yours; the data is yours; the workflows are yours.

A fourth theme emerged in the build that wasn't in the intro: **operability**. Heartbeats, stale-run reapers, dead-letter queues, incremental persistence, graceful drain on shutdown, synthetic terminal frames for hung streams. Long-running agents will crash; the platform makes crashes a non-event.

## What's Next

The big rocks on the roadmap:

1. **Generalized automation engine** — the design in §Automations, end-to-end.
2. **Parallel tool execution** — the single highest-leverage latency win.
3. **Provider fallback** — Anthropic → OpenAI → Gemini on persistent outage.
4. **Per-run cost ceilings** — alongside the existing step ceiling.
5. **Per-session isolation as opt-in** — for teams that grow beyond the single-team assumption.

If you want to follow along or run this yourself, the repo is open. The Blueprint is one click; the architecture above is what you get.

# Technical Deep Dive working title: "How to build your own coding agent platform"

## Introduction
The next generation of software will be written in large part by AI. Platforms like Cursor and Devin let you rent agents on their fully managed infrastructure. They are turn-key solutions, but come with some downsides:
- Expensive. You're paying a premium on top of every token you read/write
- Opaque inner workings makes debugging a challenge
- Other point

So, we built a 1-click deployable fully-featured coding agent platform. With coding-agents, you get:
- Scalable, fault-tolerant, long-running coding agents
- Modern streaming UX
- Automations, integrations, and observability

The platform is deployable via blueprint to Render, or via Docker anywhere.

Today, I'll break down the architecture, patterns, and implementation of coding-agents. The patterns and principles we discuss are applicable to many kinds of distributed, multi-service, and agentic applications.

## Goals and Constraints

### Agent Capabilities
- **Autonomous, long-running agents** — Agents that can run for minutes to hours without supervision, surviving transient failures and resuming from checkpoints.
- **Fully featured** — Skills, tool calling, sub-agents, file operations, shell access — the full palette a coding agent needs to ship real work.
- **Token efficiency** — Aggressive context management to keep costs low and context windows effective.

### Architectural Constraints
- **Isolated and secure** — Each agent session runs in a sandboxed environment. Untrusted code execution cannot escape its boundary.
- **Fully observable** — Every agent action, tool call, and state transition is traceable end-to-end via OpenTelemetry.
- **Fault-tolerant and scalable** — The system must recover from crashes without losing agent state. Many agents should be able to run concurrently across many workers.

### Developer Experience Goals
- **Modern streaming UX** — Real-time token streaming with sub-second perceived latency; the chat experience should be instant.
- **Pluggable architecture / no lock-in** — Swap LLM providers, tool implementations, or hosting platforms without rewriting core logic. Everything runs in containers.
- **1-click deploy on Render** — A single Blueprint deploy should stand up the full platform (web, API, workers, Redis, Postgres) with zero manual configuration.

## Architecture Overview

[Diagram: Frontend ↔ API (SSE) ↔ Redis (Streams + Pub/Sub) ↔ Worker ↔ Sandbox, with Postgres beneath API and Worker]

Brief orientation paragraph:
- Stateless API layer serves the UI and SSE connections
- Redis is the nervous system: job queue + event bus
- Workers run the agent loop, delegating execution to a shared sandbox
- Postgres stores durable state (sessions, messages, runs) and observability events
- The frontend subscribes via SSE, backed by Redis pub/sub for low-latency push

---

## The Sandbox Model

### The Design Choice: Shared Container, Logical Isolation
- One sandbox service, many sessions — isolation via `/workspace/{sessionId}` namespacing
- Contrast with per-session VMs (Vercel open-agents, E2B) — why we chose this
- Tradeoffs: faster provisioning, lower cost, but weaker blast radius

### How It Works
- Sandbox is a Bun HTTP server exposing exec, file I/O, git, glob/grep over REST
- Worker routes requests via `X-Session-Id` header
- Path traversal protection + symlink hardening
- Bearer token auth between worker and sandbox

Path security is the critical piece — every file operation validates the resolved path stays within the session boundary, with symlink dereferencing to prevent escape:

```typescript
export function validatePath(sessionId: string, filePath: string): string {
  const sessionWs = getSessionWorkspace(sessionId);
  const normalized = filePath.replace(/^\/+/, "");
  const resolved = resolve(join(sessionWs, normalized));

  // Check logical containment
  const underRoot =
    resolved === sessionWs || resolved.startsWith(sessionWs + sep);
  if (!underRoot) {
    throw new Error(`Path traversal attempt detected: ${filePath}`);
  }

  // Check real path (symlink hardening)
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

### Session Lifecycle
- `provision()` doesn't spin up infra — it returns an HTTP adapter to the shared service
- Workspace setup: clone repos or create git worktrees from bare mirrors
- Teardown: filesystem cleanup, no container lifecycle overhead

The sandbox provider is a singleton HTTP client — provisioning is instant:

```typescript
let _sandboxProvider: SandboxProvider | null = null;

function getSandboxProvider(): SandboxProvider {
  if (_sandboxProvider && Date.now() - _sandboxProviderCreatedAt < 10 * 60_000) {
    return _sandboxProvider;
  }
  const host = process.env.SANDBOX_SERVICE_HOST;
  _sandboxProvider = new SharedHttpSandboxProvider(host, secret, sessionAuth);
  return _sandboxProvider;
}

export async function getAdapter(sessionId: string): Promise<SandboxAdapter> {
  const provider = getSandboxProvider();
  return await provider.provision(sessionId);  // No infra spun up — just returns an HTTP adapter
}
```

### Scaling on Render
- Sandbox = Docker web service with 20GB persistent disk
- Workers scale independently (concurrency semaphore, MAX_CONCURRENT_RUNS=10)
- Blueprint wires it all together: one `render.yaml` stands up the full topology

The worker uses an in-process semaphore with Redis Streams consumer groups for at-least-once delivery:

```typescript
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT_RUNS ?? "10", 10);
const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const STALE_PENDING_MS = 10 * 60_000;

let active = 0;
let shuttingDown = false;

// Graceful shutdown: drain active runs before exiting
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => {
    console.info(`[worker] Received ${sig}, draining ${active} active run(s)…`);
    shuttingDown = true;
  });
}

// Heartbeat: other workers know we're alive
async function heartbeat(redis: Redis): Promise<void> {
  while (!shuttingDown) {
    await redis.set(
      `worker:heartbeat:${WORKER_ID}`,
      JSON.stringify({ active, pid: process.pid, ts: Date.now() }),
      "EX", 30,
    );
    await new Promise((r) => setTimeout(r, 24_000));
  }
}
```

### Future: Per-Session Isolation
- When/why you'd upgrade to per-session containers
- The adapter pattern makes this a swap — `SharedHttpSandboxProvider` → `IsolatedProvider`

---

## Data Model and Persistence Strategy

### Why Not Pure Event Sourcing?
- Agent sessions *feel* append-only, but chat UI needs random access to messages
- Pure ES requires replay for reads — overkill when you need "show me message 5"
- Chose a hybrid: durable CRUD tables + append-only observability log + ephemeral Redis streams

### The Core Schema
- `sessions` — workspace binding, phase, skills, git stats
- `chats` → `chat_messages` — durable chat with dual representations:
  - `parts` (UI rendering)
  - `model_messages` (LLM context for next turn)
- `agent_runs` — lifecycle state machine (queued → running → completed/failed/aborted)
- `agent_events` — append-only audit log (llm_request, tool_call, sandbox_exec, error)

### The Run State Machine
- Centralized transitions in `state-machine.ts`
- Heartbeat-based liveness detection (stale > 5 min = reapable)
- Terminal reasons tracked for debugging

### Incremental Persistence During the Loop
- Assistant messages upserted after each step (not just at turn end)
- Crash recovery: replay from last persisted message, not from event log
- This is the key difference from ES — state is written eagerly, not derived from events

### The Observability Layer (Append-Only)
- `agent_events` with parent-child links forms a span tree
- NOT used to reconstruct state — used for analytics, cost tracking, debugging
- 30-day retention with monthly partitions
- Events capped at 10,000 per run

### Tradeoffs
- **Pro:** Simple reads, no replay overhead, familiar CRUD for most queries
- **Pro:** Observability layer gives full audit trail without polluting the domain model
- **Con:** Two representations of "what happened" (messages vs events) — must stay in sync
- **Con:** No time-travel replay (can't rewind to step 3 and re-run)

---

## Streaming Architecture: Redis Streams + SSE

### The Problem
- LLM tokens arrive one at a time; tool outputs are async and interleaved
- Frontend needs sub-second rendering with reconnect resilience
- Multiple clients may watch the same session simultaneously

### Redis as the Nervous System (Two Streams, One Pub/Sub)
1. **Job queue** — `agent:jobs:stream` with consumer group `agent-workers` (at-least-once delivery)
2. **Event stream** — `run:{runId}:events` (capped at ~2000 entries, 24h TTL) for replay
3. **Pub/Sub** — `run:{runId}` channel for instant push (no replay, no persistence)

### The Dual-Write Pattern
- Worker publishes: `XADD` to stream (durable) + `PUBLISH` to channel (instant)
- Stream ID embedded in pub/sub payload as `_sid` for dedup
- If PUBLISH fails, XADD already succeeded — clients catch up on reconnect

```typescript
export async function publishRunEvent(
  redis: Redis,
  runId: string,
  payloadJson: string,
): Promise<void> {
  const key = `run:${runId}:events`;

  // 1. Durable write — capped stream (~2000 entries)
  const streamId = await redis.xadd(key, "MAXLEN", "~", "2000", "*", "e", payloadJson);

  // 2. Instant push — embed stream ID for dedup on reconnect
  try {
    const pubPayload = JSON.stringify({ _sid: streamId, ...JSON.parse(payloadJson) });
    await redis.publish(`run:${runId}`, pubPayload);
  } catch (err) {
    // XADD succeeded — clients will catch up via XRANGE on reconnect
    console.error("[run-stream] PUBLISH failed (XADD succeeded)", { runId, streamId, err });
  }
}
```

### SSE Endpoint Design
1. Client connects: `GET /api/sessions/{id}/stream`
2. **Backfill**: `XRANGE` from `0` (or `Last-Event-ID`) — replay missed events
3. **Subscribe**: Redis pub/sub on `run:{runId}` — live events
4. **Emit**: SSE frames with `id:` (stream ID) and `data:` (JSON envelope)
5. **Close**: on terminal event (`session:completed|failed|aborted`)
6. **Synthetic terminal**: if run already finished but stream missed it

The SSE endpoint handles the tricky race between history replay and live subscription:

```typescript
export async function GET(req: NextRequest, { params }) {
  const lastEventId = req.headers.get("Last-Event-ID");
  const runId = chatRow.activeRunId;

  // Buffer pub/sub messages while we replay history
  const pubsubBuffer: { sid: string | null; payload: string }[] = [];
  const sub = await subscribeToRun(runId, (message) => {
    pubsubBuffer.push({ sid: parsed._sid, payload: message });
  });

  // Replay history (all events, or after Last-Event-ID for reconnects)
  const historyEntries = lastEventId
    ? await readRunEventEntriesAfterId(cmd, runId, lastEventId)
    : await readRunEventHistoryDetailed(cmd, runId);

  // Emit history, then drain buffer (dedup by stream ID), then go live
  const stream = new ReadableStream({
    async start(controller) {
      for (const entry of historyEntries) {
        write(entry.id, entry.payload);           // Replay
      }
      for (const buffered of pubsubBuffer) {
        if (buffered.sid <= lastHistoryId) continue; // Dedup
        write(buffered.sid, buffered.payload);    // Buffered live events
      }
      // Switch to real-time pub/sub
      await subscribeToRun(runId, (message) => {
        write(sid, message);
        if (isTerminal(message)) controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

### Why SSE Over WebSockets
- Unidirectional is sufficient (user input goes through REST, not the stream)
- HTTP/2 multiplexing, built-in browser reconnect, simpler infrastructure
- `Last-Event-ID` gives free resumption semantics

### Event Envelope (v2)
- Shape: `{ v: 2, type, ts, requestId?, payload }`
- Types: `agent:message`, `agent:tool_call`, `agent:tool_result`, `agent:heartbeat`, `session:completed`, etc.

### Steering: Bidirectional Communication Over Pub/Sub

User inputs while the agent is running (stop, inject message) flow through a separate Redis channel:

```typescript
export async function publishSteeringEvent(
  redis: Redis,
  runId: string,
  event: { type: string; content?: string; reason?: string },
): Promise<void> {
  const payload = JSON.stringify({ ...event, ts: new Date().toISOString() });
  await redis.publish(`run:${runId}:steering`, payload);
  // Also persist to a list (agent polls between steps)
  await redis.rpush(`run:${runId}:steering:queue`, payload);
  await redis.expire(`run:${runId}:steering:queue`, 3600);
}
```

### Frontend Consumption
- `useEventSource` hook with auto-reconnect (backoff, max 5 attempts)
- Events reduced through `chatReducer` — incremental UI updates
- Token streaming: partial message chunks rendered as they arrive

---

## Observability

### Why It's Non-Negotiable for Agents
- Non-deterministic, multi-step, minutes-long runs
- "Why did the agent do X?" is unanswerable from logs alone
- Cost tracking requires per-request token accounting

### The Lightweight OTel Approach
- No `@opentelemetry/*` SDK dependency — custom OTLP exporter
- Why: full SDK is heavy, auto-instrumentation noisy for agent workloads
- Custom `ObservabilityRecorder` gives precise control over what's traced

### Span Model
- One trace per run (trace ID = run ID)
- Parent-child spans: LLM request → tool calls → sandbox exec
- Attributes: `session.id`, `tool.name`, `model`, `token.count`, `duration`
- Batched flush (500ms) to Postgres + optional OTLP endpoint

### What Gets Recorded
- Every LLM request (model, tokens in/out, latency, cost)
- Every tool call (name, args summary, result size, duration)
- Every sandbox exec (command, exit code, duration)
- Errors with full context

### Guardrails
- Event cap per run (10,000)
- Metadata size truncation (4KB)
- Credential redaction before storage
- Retention: 30-day rolling partitions

### Vendor Neutrality
- OTLP/HTTP JSON export to any backend (Jaeger, Datadog, Honeycomb)
- Postgres observability tables serve as built-in backend for the dashboard
- Ties back to "no lock-in" constraint



### The Core Loop: Simple by Design
- The inner loop is ~300 lines. Deliberately minimal. No plugin system, no middleware chain — just an LLM call, tool execution, and message accumulation.
- Why: Complexity in the loop is invisible complexity. Every abstraction here costs you debuggability. When the agent does something wrong at step 47, you need to trace exactly what happened. Keep it flat.

Here's the actual loop — stripped of error handling for clarity:

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
- LLM calls are retried up to 3 times for transient errors (429, 5xx, network failures).
- Backoff: 1s → 4s → 16s. Not jittered (single-worker, no thundering herd concern at this scale).

```typescript
const LLM_MAX_RETRIES = 3;
const LLM_RETRY_BACKOFF = [1000, 4000, 16000];

function isTransientLlmError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("429") || msg.includes("rate limit") || msg.includes("overloaded") ||
    msg.includes("500") || msg.includes("502") || msg.includes("503") ||
    msg.includes("network") || msg.includes("econnreset") || msg.includes("timeout")
  );
}

async function chatWithRetry(provider: LLMProvider, chatParams): Promise<LLMResponse> {
  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    try {
      return await provider.chat(chatParams);
    } catch (err) {
      if (!isTransientLlmError(err) || attempt === LLM_MAX_RETRIES - 1) throw err;
      await new Promise((r) => setTimeout(r, LLM_RETRY_BACKOFF[attempt]));
    }
  }
}
```

#### Empty Response Handling
- LLMs sometimes return empty responses (no text, no tool calls). Rather than failing, retry up to 2 times silently.
- If still empty after retries, terminate gracefully with reason `empty_response`.

#### Abort and Timeout
- Two abort mechanisms merged into a single `AbortController`:
  1. **User-initiated**: Redis key `run:{runId}:abort` polled every 500ms
  2. **Turn timeout**: fires after 10 minutes
- Both propagate through the same signal — tools respect `signal.aborted` and bail cleanly.

```typescript
export function createMergedAbortController(
  events: EventBus,
  runId: string,
  timeoutMs: number,
): { controller: AbortController; cleanup: () => void } {
  const controller = new AbortController();

  // Timeout abort
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new DOMException("Turn timeout", "TimeoutError"));
    }
  }, timeoutMs);

  // User-initiated abort (polled from Redis)
  const pollInterval = setInterval(async () => {
    const val = await events.getKey(`run:${runId}:abort`);
    if (val === "1" && !controller.signal.aborted) {
      controller.abort(new DOMException("User stopped", "AbortError"));
    }
  }, 500);

  return { controller, cleanup: () => { clearTimeout(timeout); clearInterval(pollInterval); } };
}
```

#### Incremental Persistence
- After every step, the assistant message is upserted to Postgres. If the worker crashes at step 15, steps 1–14 are already persisted.
- The user can send a follow-up message and the agent continues from the last persisted state — no replay needed.

### Steering: Human-in-the-Loop Mid-Run
- Between steps, the loop checks for "steering events" — user messages injected while the agent is running.
- Types: `user:message` (inject context), `user:interrupt` (stop the run)
- Consumed from a Redis list via `consumeSteering()`.
- This enables "hey, actually also fix the tests" without waiting for the turn to complete.

The check happens at the bottom of each loop iteration:

```typescript
// Inside agentLoop, after tool execution and onStep:
if (onSteeringCheck) {
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
}
```

The steering queue is a Redis list that the frontend pushes to and the agent drains atomically:

```typescript
export async function consumeSteeringEvents(redis: Redis, runId: string) {
  const key = `run:${runId}:steering:queue`;
  const items = await redis.lrange(key, 0, -1);
  if (items.length > 0) await redis.del(key);  // Atomic drain
  return items.map((item) => JSON.parse(item));
}
```

### Token Economics
- Every step logs: input tokens, output tokens, cache creation, cache read.
- Cache-aware: Anthropic's prompt caching means repeated system prompts and early messages are cheap after the first call.
- Step limit (default 100) prevents runaway cost — but most turns complete in 5-15 steps.
- Sub-agents use cheaper models by default (Haiku) for routine work.

### What We'd Do Differently
- **Parallel tool execution**: Currently sequential. Independent tool calls (read_file + grep) could run concurrently. We haven't needed it yet because the LLM call dominates latency, but at scale it matters.
- **Smarter compaction**: Current strategy is purely positional (age-based). Could be semantic — compact results the model hasn't referenced recently.
- **Streaming tool results**: Some tools (bash, build) produce incremental output. Today we wait for completion. Streaming them would improve UX for long builds.

--- Notes

Tool compaction with lazy retrieval — this is a novel pattern most readers won't have seen. The get_tool_result tool that lets the agent "page in" old context is elegant and worth a code snippet.

Merged abort controller — combining user-stop and timeout into one signal is a pattern people struggle with. Worth showing the 15-line implementation.

Steering mid-run — the ability to inject messages while the agent is working is unusual and powerful. Most agent frameworks don't support this.

Incremental persistence — the "crash at step 15, recover steps 1–14" story is a strong reliability narrative that ties back to the fault-tolerance constraint.

Sub-agent model selection — letting the agent choose to delegate to a cheaper model for routine work is a cost optimization that's practical and interesting.

---

## Automations and Integrations

### The Vision: Agents That Fire Themselves

So far, everything we've discussed requires a human to start a session. But the real power of coding agents comes when they run autonomously — triggered by events in your workflow:

- A PR is opened → an agent reviews the code and posts comments (BugBot)
- A cron job fires daily → an agent audits dependencies for vulnerabilities
- A Linear issue is assigned to "agent-bot" → an agent implements the feature
- A Slack message mentions "@agent fix the flaky test" → an agent investigates and pushes a fix

The automation engine binds **triggers** to **agent configurations** — creating an entity that says "when X happens, spawn an agent with prompt Y, tools Z, targeting repos R."

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

Rapid-fire events are a real problem. 50 pushes to a PR in 2 minutes shouldn't spawn 50 agent sessions. The engine handles this with:

- **Coalesce window** (configurable per automation, default 60s)
- **Dedup key**: `automation:{id}:{repo}:{pr_number}` stored in Redis with TTL = coalesce window
- When a new event arrives within the window: cancel the pending/running session, start a fresh one with the latest context

### BugBot: The Flagship Automation

BugBot is a pre-built automation template that validates the entire system:
1. Triggers on PR opened/updated
2. Runs code review using a specialized prompt + `.cursor/BUGBOT.md` rules
3. Posts inline PR comments with findings
4. Optionally spawns a follow-up agent to push autofix commits

It's not special — it's just an automation with a well-tuned prompt. Any user can build something similar.

### The Adapter Pattern: Adding New Event Sources

Adding a new trigger source (e.g., Jira, PagerDuty, custom webhook) requires:
1. A **normalizer** function: `rawEvent → InboundEvent` (canonical format)
2. A **trigger condition schema**: what fields can be filtered on
3. A **webhook endpoint** in the gateway

No changes to the router, matcher, dispatcher, or agent execution. This is the "pluggable architecture" constraint paying off.

### What's Not Built Yet

This section describes the designed architecture. The scheduler, matcher, and adapter layer are spec'd but not implemented. The existing InboundRouter handles GitHub events today; the automation entity and multi-source triggers are next.


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
- **`parentEventId`** creates a tree structure (mimics span parent/child) — enables drill-down from LLM request → tool calls → sandbox execs
- **`seriesId`** normalizes the session+eventType pair out of every row (reduces index bloat)
- **`metadata` as JSONB** — flexible schema per event type. LLM requests store token counts and model ID; tool calls store tool name and duration; errors store stack traces.
- **Monthly partitions** — `agent_events` is range-partitioned by `created_at`. The retention job drops entire partitions older than 30 days rather than row-by-row deletes.

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
- **Sampling for high-volume deployments** — Currently every event is recorded. At scale, you'd want head-based sampling for the OTLP export while keeping Postgres at full fidelity for cost tracking.
- **Structured logs correlation** — Console logs aren't correlated to trace IDs. Wiring `traceId` into structured logs would complete the picture.
- **Metrics pipeline** — We export traces but not OTel metrics. Histograms of LLM latencies, counters of tool errors, gauges of concurrent runs — these would be valuable for alerting.

Cross cutting concerns: UX, DX, reliability, stability, inspectability, pluggability, extensibility, maintainability. 










-- Old notes 
Early thoughts. Will want an annoucnement blog post and a technical deep dive. 

Announcement blog post working title: "1-click deploy an open source coding agent platform" (Own coding agents on your infrastructure)
- Position open source release as demonstrating modern architectures for streaming, long-lived agentic workloads
- Emphasize 1-click deploy, low TCO, and no lock-in / completely pluggable and hostable anywhere with containers
- Emphasize Render's strenghts for long runnin agents against serverless offerings, dissect `open-agents` from Vercel in a positive but realist tone. Lead to Technical Deep Dive ->


- Building an Agent Loop (EDA, Context/Token management (ex tool compaction), subagents)
- Modern streaming architecture on Redis Streams (SSE, UX)
- Event sourcing on Postgres 
- Dynamic infrastructure provisioning and the Sandbox model
- Automation engine
- Other items:
  - O11y, OTel
  - 
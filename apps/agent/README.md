# agent

Persistent Bun worker that consumes agent jobs from Redis Streams, runs multi-step LLM execution (Anthropic / OpenAI via Vercel AI SDK), and streams results back to the web app.

## Quick Start

```bash
# Starts automatically with the monorepo dev command
bun run dev            # from monorepo root

# Or run standalone (with --watch for live reload)
bun run --watch src/worker.ts
```

## How It Works

1. **Worker loop** (`src/worker.ts`) — reads jobs from a Redis Streams consumer group with bounded concurrency.
2. **Turn logic** (`src/agent.ts`) — orchestrates a single agent turn: sends messages to the LLM, processes tool calls, and publishes streaming events.
3. **Tool execution** (`src/tools/`) — each tool (file read/write, shell, grep, git, web search, PR creation, etc.) is defined as a schema + handler and executed via the sandbox HTTP API.
4. **Subagents** — the agent can spawn child agents for parallel work, coordinated through the same Redis infrastructure.

Results and progress are streamed back through `@openforge/platform` event publishing so the web UI can display them in real time via SSE.

## Key Files

| Path | Description |
|------|-------------|
| `src/worker.ts` | Main entry — Redis consumer loop, concurrency gating |
| `src/agent.ts` | Core turn logic — LLM calls, tool dispatch, event emission |
| `src/tools/` | Tool definitions and handlers |

## Workspace Dependencies

- **`@openforge/platform`** — DB access and event publishing
- **`@openforge/db`** — Drizzle schema
- **`@openforge/sandbox`** — sandbox HTTP client for tool execution
- **`@openforge/shared`** — shared types and constants
- **`@openforge/skills`** — agent skill definitions

## Notable External Dependencies

- `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai` — Vercel AI SDK
- `ioredis` — Redis Streams consumer
- `drizzle-orm` / `postgres` — DB access
- `nanoid` — ID generation

## Scripts

| Script | Command |
|--------|---------|
| `dev` | `bun run --watch src/worker.ts` |
| `start` | `bun run src/worker.ts` |
| `typecheck` | `tsc --noEmit` |

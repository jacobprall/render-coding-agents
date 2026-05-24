# agent

Persistent Bun worker that consumes agent jobs from Redis Streams, runs multi-step LLM execution (Anthropic / OpenAI via direct API calls), and streams results back to the web app.

## Quick Start

```bash
# Starts automatically with the monorepo dev command
bun run dev            # from monorepo root

# Or run standalone (with --watch for live reload)
bun run --watch src/worker.ts
```

## How It Works

1. **Worker loop** (`src/worker.ts`) — reads jobs from a Redis Streams consumer group with bounded concurrency.
2. **Turn orchestration** (`src/agent.ts`) — orchestrates a single agent turn: provisions sandbox, sets up workspace, runs the LLM loop, creates PRs for changed repos, and finalizes status.
3. **Agent loop** (`src/loop.ts`) — the core execution loop: sends messages to the LLM, dispatches tool calls, compacts context, and tracks usage.
4. **Tool execution** (`src/tools/`) — each tool (file read/write, shell, grep, git, web search, PR creation, etc.) is defined as a schema + handler and executed via the sandbox HTTP API.
5. **Subagents** — the agent can spawn child agents for parallel work via the `task` tool.

Results and progress are streamed back through `@coding-agents/platform` event publishing so the web UI can display them in real time via SSE.

## Key Files

| Path | Description |
|------|-------------|
| `src/worker.ts` | Main entry — Redis consumer loop, concurrency gating, skill resolution |
| `src/agent.ts` | Turn orchestration — workspace setup, LLM loop invocation, PR creation |
| `src/loop.ts` | Core agent loop — LLM calls, tool dispatch, context compaction |
| `src/tools/` | Tool definitions and handlers |
| `src/observability.ts` | Event recording and OTLP span export |
| `src/run-persistence.ts` | Message persistence and event streaming |
| `src/system-prompt.ts` | System prompt assembly with skills, context, and workspace info |
| `src/providers.ts` | Forge provider and sandbox adapter resolution |

## Workspace Dependencies

- **`@coding-agents/platform`** — DB access, event publishing, LLM key resolution
- **`@coding-agents/db`** — Drizzle schema
- **`@coding-agents/sandbox`** — sandbox HTTP client for tool execution
- **`@coding-agents/shared`** — shared types, constants, and encryption utilities

## Notable External Dependencies

- `ioredis` — Redis Streams consumer
- `drizzle-orm` / `postgres` — DB access
- `nanoid` — ID generation
- `zod` — schema validation

## Scripts

| Script | Command |
|--------|---------|
| `dev` | `bun run --watch src/worker.ts` |
| `start` | `bun run src/worker.ts` |
| `typecheck` | `tsc --noEmit` |
| `test` | `bun test tests` |

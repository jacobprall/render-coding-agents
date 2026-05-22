# Implementation Plan: Agent Module Audit Remediation

**Branch**: `008-agent-audit` | **Date**: 2026-05-22 | **Spec**: `specs/008-agent-audit/spec.md`

**Input**: Feature specification from `specs/008-agent-audit/spec.md`

## Summary

The `apps/agent` module is the most complex in the system — 1,100+ lines in `agent.ts` alone — and the audit surfaced nine concrete weaknesses ranging from data-loss bugs (observability flush, tool-result merge) to architectural debt (god module, no tests). This plan decomposes the nine issues into six workstreams that can largely be parallelized: (1) fix the two data-loss bugs, (2) inject resolved skill content into the system prompt, (3) decompose `agent.ts`, (4) harden shell command construction, (5) propagate parent signals to subagents, and (6) add test coverage and update documentation. The forge-provider abstraction (full multi-provider support) is deferred to a separate plan since it requires cross-module schema and platform changes beyond the agent package.

## Technical Context

**Language/Version**: TypeScript (Bun runtime, Node.js compat)

**Primary Dependencies**: `ioredis`, `drizzle-orm`, `nanoid`, `zod`, `@coding-agents/platform`, `@coding-agents/sandbox`, `@coding-agents/shared`, `@coding-agents/db`

**Storage**: PostgreSQL 16 via Drizzle ORM; Redis Streams for queue/events

**Testing**: `bun test` (Bun's built-in test runner); no existing test infrastructure in `apps/agent`

**Target Platform**: Linux server (Docker sandbox sidecar)

**Project Type**: Worker process (Bun, Redis Streams consumer)

**Performance Goals**: 10 concurrent sessions per instance, sub-second workspace setup

**Constraints**: Must not change public tool names or event formats (backward compat); must not regress streaming behavior

**Scale/Scope**: ~9,600 LOC in `apps/agent`; ~2,400 LOC directly affected across `agent.ts` (1,100), `observability.ts` (356), `run-persistence.ts` (177), `tools/task.ts` (91), `system-prompt.ts` (191), `worker.ts` (302), `providers.ts` (77), `README.md` (54)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Simplicity | PASS | Decomposition reduces complexity; no new dependencies added |
| II. Observability | PASS | Fixes observability data loss (issue 8); improves debuggability |
| III. Modularity | PASS | Decomposing `agent.ts` is a direct application of this principle |
| IV. API-First | PASS | No API surface changes; internal refactor only |
| V. Reliability | PASS | Fixes data-loss bugs (issues 8, 9); adds requeue on flush failure |
| VI. Security | PASS | Hardens shell command construction (issue 3) |
| VII. Testing Discipline | PASS | Adds test coverage for critical paths (issue 4) |
| VIII. OSS-Friendly | PASS | Updates stale documentation (issue 5) |
| IX. Performance | N/A | No performance-impacting changes |

**Gate result**: PASS — all applicable principles satisfied.

**Post-Phase-1 re-check**: PASS — design introduces no new abstractions, packages, or external dependencies. All changes stay within `apps/agent`.

## Project Structure

### Documentation (this feature)

```text
specs/008-agent-audit/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (internal interfaces)
└── tasks.md             # Phase 2 output (deferred to /speckit-tasks)
```

### Source Code (repository root)

```text
apps/agent/
├── src/
│   ├── agent.ts                  # DECOMPOSE → retained as thin re-export
│   ├── workspace.ts              # NEW — workspace setup, clone, worktree logic
│   ├── pr-manager.ts             # NEW — PR creation, diff stats, push logic
│   ├── turn-orchestrator.ts      # NEW — single turn lifecycle (claim → execute → finalize)
│   ├── lib/
│   │   └── shell-escape.ts       # NEW — POSIX shell escaping utility
│   ├── loop.ts                   # Unchanged
│   ├── observability.ts          # FIX flushNow() requeue-on-failure
│   ├── run-persistence.ts        # FIX mergeToolResults() preserve unmatched
│   ├── system-prompt.ts          # FIX inject resolved skill content
│   ├── providers.ts              # FIX use session.forgeType
│   ├── worker.ts                 # FIX pass forgeUsername/projectRepoPath
│   ├── tools/
│   │   └── task.ts               # FIX propagate abort, recorder, secrets
│   └── README.md                 # REWRITE to match implementation
├── tests/                        # NEW — test directory
│   ├── observability.test.ts
│   ├── run-persistence.test.ts
│   ├── loop.test.ts
│   ├── workspace.test.ts
│   ├── url-safety.test.ts
│   └── system-prompt.test.ts
```

**Structure Decision**: The existing monorepo structure (`apps/agent`) is preserved. `agent.ts` is decomposed into three focused modules under `src/`. A `shellEscape` utility is added under `src/lib/`. Tests are added under `apps/agent/tests/`.

## Workstream Breakdown

### WS-1: Data-Loss Bug Fixes (Issues 8 & 9) — Priority P1

**Issue 8 — `ObservabilityRecorder.flushNow()` drops queued data on failure**

Current code (`observability.ts` lines 224–225):
```typescript
const rows = this.queue.splice(0, this.queue.length);
const spans = this.spans.splice(0, this.spans.length);
try { await this.platform.observability.recordBatch(rows); }
catch { /* rows permanently lost */ }
```

Fix — copy-then-confirm pattern:
```typescript
const rowCount = this.queue.length;
const spanCount = this.spans.length;
const rows = this.queue.slice(0, rowCount);
const spans = this.spans.slice(0, spanCount);

try {
  if (rows.length > 0) {
    await this.platform.observability.recordBatch(rows);
    this.queue.splice(0, rowCount);
  }
} catch (error) {
  console.warn("[observability] failed to persist events, will retry:", error);
}

try {
  if (this.otlpExporter && spans.length > 0) {
    await this.otlpExporter.exportBatch(spans);
    this.spans.splice(0, spanCount);
  }
} catch (error) {
  console.warn("[observability] failed to export OTLP spans, will retry:", error);
}
```

Items remain in the queue for the next periodic flush. The `eventCap` prevents unbounded growth.

**Issue 9 — `mergeToolResults()` drops unmatched `tool_result` parts**

Current code (`run-persistence.ts` lines 50–55):
```typescript
} else if (part.type === "tool_result" && typeof part.toolCallId === "string") {
  const idx = toolCallIndices.get(part.toolCallId);
  if (idx !== undefined) {
    merged[idx] = { ...merged[idx], result: part.result };
  }
  // else: silently dropped
}
```

Fix — append unmatched results:
```typescript
} else if (part.type === "tool_result" && typeof part.toolCallId === "string") {
  const idx = toolCallIndices.get(part.toolCallId);
  if (idx !== undefined) {
    merged[idx] = { ...merged[idx], result: part.result };
  } else {
    merged.push(part);
  }
}
```

### WS-2: Skill Resolution Fix (Issue 1) — Priority P1

Two changes:

1. **`worker.ts`** (`resolveJobSkills`): Extract `forgeUsername` and repo path from the job payload instead of passing empty strings:
   ```typescript
   resolvedSkills = await resolveActiveSkills(forge, {
     activeSkills: activeRefs,
     forgeUsername: job.forgeUsername ?? "",
     projectRepoPath: job.repos?.[0]?.repoPath ?? "",
   });
   ```

2. **`system-prompt.ts`** (`buildAgentSystemPrompt`): Add `resolvedSkillContents` option. After the skill index table, inject each resolved skill's full content:
   ```typescript
   if (opts.resolvedSkillContents?.length) {
     for (const skill of opts.resolvedSkillContents) {
       parts.push(`\n# Skill: ${skill.slug}\n\n${skill.content}`);
     }
   }
   ```

3. **`agent.ts`** (or `turn-orchestrator.ts` post-decomposition): Pass `resolvedSkills` content to `buildAgentSystemPrompt()`:
   ```typescript
   const systemPrompt = buildAgentSystemPrompt({
     skillIndex: resolvedSkills.map(s => ({ source: s.source, slug: s.slug, name: s.name, description: s.description })),
     resolvedSkillContents: resolvedSkills.filter(s => s.content).map(s => ({ slug: s.slug, content: s.content })),
     // ...existing opts
   });
   ```

### WS-3: Agent.ts Decomposition (Issue 2) — Priority P2

Extract three modules preserving existing function signatures:

| New Module | Functions Moved | Approx. Lines |
|---|---|---|
| `workspace.ts` | `setupWorkspace()`, `setupScratchWorkspace()`, `cloneRepoIntoSubdir()`, multi-repo setup, worktree creation/cleanup, mirror fallback | ~300 |
| `pr-manager.ts` | `createPrsForChangedRepos()`, `getDiffStats()`, push-and-create logic, PR description building | ~200 |
| `turn-orchestrator.ts` | `runAgentTurn()` — claim run, provision sandbox, build tools, call loop, call PR manager, finalize | ~300 |

`agent.ts` retained as a thin re-export: `export { runAgentTurn } from "./turn-orchestrator"` so `worker.ts` import doesn't change.

Each extracted module receives dependencies via function parameters (existing DI pattern). No new classes or abstractions.

### WS-4: Shell Command Safety (Issue 3) — Priority P2

1. Create `src/lib/shell-escape.ts`:
   ```typescript
   export function shellEscape(s: string): string {
     if (s.includes('\0')) throw new Error('Null byte in shell argument');
     return `'${s.replace(/'/g, "'\\''")}'`;
   }
   ```

2. Audit all string-interpolated shell commands in workspace setup (`setupWorkspace`, `cloneRepoIntoSubdir`, push/diff helpers). Apply `shellEscape()` to interpolated variables: `repoPath`, `branchName`, `baseBranch`, `cloneUrl`, workspace paths.

3. Where possible, prefer the git tool's argv execution over bash string commands.

### WS-5: Subagent Signal Propagation (Issue 7) — Priority P2

Extend `taskTool()` constructor to accept and forward parent signals:

```typescript
export function taskTool(
  publishFn: (event: StreamEvent) => Promise<void>,
  buildSubTools: () => Record<string, ToolConfig>,
  modelResolver: SubagentModelResolver,
  forgeContext: ForgeAgentContext,
  parentSystemPromptSuffix?: string,
  parentSignals?: {
    signal?: AbortSignal;
    recorder?: ObservabilityRecorder;
    secrets?: Record<string, string>;
    resultStore?: Map<string, string>;
  },
)
```

Inside `execute`, pass to `agentLoop()`:
```typescript
const result = await agentLoop({
  // ...existing params
  signal: parentSignals?.signal,
  recorder: parentSignals?.recorder,
  secrets: parentSignals?.secrets,
  resultStore: parentSignals?.resultStore,
});
```

### WS-6: Documentation & Tests (Issues 4 & 5) — Priority P2/P3

**Documentation**: Rewrite `apps/agent/README.md` to reflect:
- `@coding-agents/*` package names (not `@openforge/*`)
- Direct fetch LLM calls (not Vercel AI SDK)
- Actual dependencies from `package.json`
- Accurate architecture description

**Tests**: Add `"test": "bun test tests"` to `apps/agent/package.json`. Create:

| Test File | Coverage Target |
|---|---|
| `tests/observability.test.ts` | `flushNow()` requeue; event cap; metadata sanitization |
| `tests/run-persistence.test.ts` | `mergeToolResults()` — matched, unmatched, ordering |
| `tests/url-safety.test.ts` | SSRF hardening, private IP detection, redirect validation |
| `tests/system-prompt.test.ts` | Skill content injection, project context, scratch vs repo |
| `tests/loop.test.ts` | Step limits, abort handling, compaction triggers |
| `tests/workspace.test.ts` | `shellEscape()` correctness, edge cases |

### Deferred: Full Multi-Provider Forge Support (Issue 6 — partial)

Full multi-provider support requires cross-module changes (`packages/platform`, `packages/db`, `apps/gateway`). Deferred to a separate spec.

**Minimal fix in this plan**: Update `providers.ts` to use `session.forgeType ?? "github"` instead of hardcoded `"github"` in the sync connection query.

## Complexity Tracking

No constitution violations requiring justification. All changes stay within `apps/agent`. No new packages, services, or abstractions introduced.

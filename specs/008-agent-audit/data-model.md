# Data Model: Agent Module Audit Remediation

**Date**: 2026-05-22 | **Feature**: 008-agent-audit

This plan is an internal refactor of `apps/agent`. No new database tables or external data models are introduced. This document describes the internal data structures that are modified or introduced.

## Modified Entities

### ObservabilityRecorder (observability.ts)

**Current state**: `queue: NewAgentEventInput[]` and `spans: Array<...>` are spliced before flush, losing data on failure.

**Modified behavior**: `flushNow()` uses copy-then-confirm pattern.

| Field | Type | Change |
|-------|------|--------|
| `queue` | `NewAgentEventInput[]` | No type change; flush logic changes from splice-before-try to slice-then-splice-on-success |
| `spans` | `Array<OtlpSpan>` | Same pattern as queue |

**State transitions for flush**:
```
queue has items → flushNow() called
  → slice queue (non-destructive copy)
  → recordBatch(copy) succeeds → splice confirmed count from queue
  → recordBatch(copy) fails → items remain in queue → next timer cycle retries
  → eventCap reached → new events rejected via canRecordMore() (unchanged)
```

### mergeToolResults / AssistantPart (run-persistence.ts)

**Current state**: `tool_result` parts with no matching `tool_call` are silently dropped.

**Modified behavior**: Unmatched `tool_result` parts are appended to the output array.

| Part Type | Matching? | Current | New |
|-----------|-----------|---------|-----|
| `tool_call` | — | Added to output, indexed by toolCallId | Unchanged |
| `tool_result` | Has matching `tool_call` | Merged into tool_call entry | Unchanged |
| `tool_result` | **No** matching `tool_call` | **Dropped** | **Appended to output** |
| `text`, other | — | Passed through | Unchanged |

### SystemPromptOpts (system-prompt.ts)

**Current fields** (unchanged):
- `skillIndex?: SkillSummary[]` — summary table for `load_skill` tool
- `projectContext?: string | null`
- `projectConfig?: unknown`
- `forgeLabel?: string`
- `isScratch?: boolean`

**New field**:

| Field | Type | Description |
|-------|------|-------------|
| `resolvedSkillContents` | `Array<{slug: string; content: string}> \| undefined` | Full markdown content of resolved skills, injected after the skill index table as individual `# Skill: {slug}` sections |

### taskTool constructor (tools/task.ts)

**Current parameters**: `publishFn`, `buildSubTools`, `modelResolver`, `forgeContext`, `parentSystemPromptSuffix`

**New parameter**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `parentSignals` | `{ signal?: AbortSignal; recorder?: ObservabilityRecorder; secrets?: Record<string, string>; resultStore?: Map<string, string> } \| undefined` | Parent execution signals forwarded to child `agentLoop()` |

### getForgeProviderForSession (providers.ts)

**Current behavior**: Hardcodes `provider: "github"` in sync connection query.

**Modified behavior**: Uses `session.forgeType ?? "github"` in the query.

| Field | Current | New |
|-------|---------|-----|
| `syncConnections.provider` filter | `"github"` (literal) | `session.forgeType ?? "github"` |

### resolveJobSkills (worker.ts)

**Current behavior**: Passes `forgeUsername: ""` and `projectRepoPath: ""` to `resolveActiveSkills()`.

**Modified behavior**: Extracts values from the job payload.

| Parameter | Current | New |
|-----------|---------|-----|
| `forgeUsername` | `""` | `job.forgeUsername ?? ""` |
| `projectRepoPath` | `""` | `job.repos?.[0]?.repoPath ?? ""` |

## New Entities

### shellEscape (lib/shell-escape.ts)

```typescript
export function shellEscape(s: string): string
```

Pure function. Takes an arbitrary string, returns a POSIX-safe single-quoted shell literal. Used by workspace setup commands to safely interpolate variables into bash commands.

**Validation rules**:
- Input must not contain null bytes → throws `Error`
- All other characters handled by single-quote wrapping: `'${s.replace(/'/g, "'\\''")}'`
- Empty string returns `''`

**Examples**:
| Input | Output |
|-------|--------|
| `hello` | `'hello'` |
| `it's` | `'it'\''s'` |
| `feat/user#42` | `'feat/user#42'` |
| `$(rm -rf /)` | `'$(rm -rf /)'` |
| `""` (empty) | `''` |

## Decomposition Mapping

Functions moving from `agent.ts` to new modules. All signatures preserved.

| Function | From | To | Approx. Lines |
|----------|------|-----|---------------|
| `setupWorkspace()` | `agent.ts` | `workspace.ts` | ~80 |
| `setupScratchWorkspace()` | `agent.ts` | `workspace.ts` | ~30 |
| `cloneRepoIntoSubdir()` | `agent.ts` | `workspace.ts` | ~70 |
| Multi-repo worktree setup | `agent.ts` | `workspace.ts` | ~120 |
| `createPrsForChangedRepos()` | `agent.ts` | `pr-manager.ts` | ~100 |
| `getDiffStats()` | `agent.ts` | `pr-manager.ts` | ~50 |
| Push-and-create-PR helpers | `agent.ts` | `pr-manager.ts` | ~50 |
| `runAgentTurn()` | `agent.ts` | `turn-orchestrator.ts` | ~300 |
| Shared helpers, constants | `agent.ts` | Inline or re-export | ~50 |

Post-decomposition, `agent.ts` becomes:
```typescript
export { runAgentTurn } from "./turn-orchestrator";
```

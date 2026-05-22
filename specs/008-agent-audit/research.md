# Research: Agent Module Audit Remediation

**Date**: 2026-05-22 | **Feature**: 008-agent-audit

## Research Tasks

### R1: Best practices for requeue-on-failure in batched flush patterns

**Decision**: Copy-then-splice pattern with bounded retry via existing `eventCap`.

**Rationale**: The standard approach for flush-based batching (used by OpenTelemetry SDKs, structured logging libraries, and analytics pipelines) is to copy the queue before attempting the flush, then only remove items on success. This avoids both data loss and unbounded memory growth.

**Key findings**:
- OpenTelemetry's `BatchSpanProcessor` uses a similar copy-then-confirm pattern.
- The retry must be bounded to prevent unbounded queue growth if the backend is permanently down. The existing `eventCap` (default 10,000) and `canRecordMore()` check already provide this bound — new events are rejected once the cap is hit, regardless of flush state.
- The `flushInFlight` guard already prevents concurrent flushes, which is correct.
- The periodic flush timer (default 500ms) automatically provides retries without additional retry logic.
- Implementation: `slice()` instead of `splice()` before the try; `splice()` the successfully-flushed count inside the try after success.

**Alternatives considered**:
- Explicit retry queue with counters: More complex, marginal benefit given the periodic flush timer already retries.
- Write-ahead log to disk: Overkill for observability events that are non-critical telemetry.
- Exponential backoff: Unnecessary since the existing `flushIntervalMs` timer spaces retries adequately.

### R2: Handling unmatched tool_result parts in mergeToolResults

**Decision**: Append unmatched `tool_result` parts to the output array.

**Rationale**: The purpose of `mergeToolResults()` is to normalize persisted chat history to match the live streaming shape. In normal operation, every `tool_result` should follow its `tool_call`. However, partial persistence failures, race conditions, or future format changes could produce orphaned results. Silently dropping them loses data that could be useful for debugging or display.

**Key findings**:
- The UI's `chatReducer` in `apps/web` already handles `tool_result` parts independently — it attaches results to matching tool_call parts but doesn't crash on orphans.
- Appending orphaned results preserves data without breaking any consumer.
- Verified no downstream code assumes `mergeToolResults()` filters out unmatched results.

**Alternatives considered**:
- Log + drop: Loses data, adds noise.
- Throw: Too aggressive for a normalization function called in persistence paths.
- Separate orphan array in return type: Over-engineers the interface.

### R3: Agent.ts decomposition strategy — extract vs. rewrite

**Decision**: Extract-and-delegate, preserving function signatures.

**Rationale**: `agent.ts` has three clearly separable responsibility clusters:

1. **Workspace setup** (~300 lines): `setupWorkspace()`, `cloneRepoIntoSubdir()`, scratch setup, multi-repo worktree creation, mirror fallback cloning.
2. **PR management** (~200 lines): `createPrsForChangedRepos()`, diff stats, push logic, PR description construction.
3. **Turn orchestration** (~300 lines): `runAgentTurn()` — claim run, provision sandbox, build tools, call loop, finalize.

**Key findings**:
- Existing function signatures use parameter objects (`{job, db, adapter, ...}`) — dependency injection via function arguments. No changes needed to extract.
- `runAgentTurn` is the only public entry point called by `worker.ts`. It can be re-exported from `agent.ts` to maintain backward compatibility.
- Shared helpers (e.g., `agentLog`, constants) are small enough to inline or re-export.
- Risk: extracting functions that share local closures or module-level state. Audited: the only module-level state is in `providers.ts` (sandbox provider cache), which is already separate.

**Alternatives considered**:
- Class-based decomposition (AgentRunner class): Adds unnecessary abstraction; the current function-based DI is simpler and aligns with Constitution Principle I (Simplicity).
- Leave as-is with regions/comments: Doesn't solve cognitive load or change-risk.
- Full rewrite: Unnecessary risk for a working system; extract preserves behavior.

### R4: Shell command construction hardening approaches

**Decision**: `shellEscape()` utility for bash commands; prefer git tool's argv path where possible.

**Rationale**: The sandbox already supports two execution modes: `runCommand()` (bash -lc, string command) and `runArgv()` (direct argv, no shell). The git endpoint uses `runArgv()` with a subcommand policy. Workspace setup uses `runCommand()` with string interpolation.

**Key findings**:
- The sandbox `exec` endpoint only exposes `runCommand()` (bash shell) to the agent. Converting to argv would require changes to the sandbox API — out of scope.
- For git operations, the agent's `git` tool already uses the sandbox's `/git` endpoint which uses argv execution. Workspace setup should prefer this where possible.
- For remaining bash commands, POSIX single-quote escaping is the standard: `'${s.replace(/'/g, "'\\''")}'`. This handles all characters except null bytes.
- Variables needing escaping in workspace setup: `repoPath`, `branchName`, `baseBranch`, `cloneUrl`, dynamic workspace paths.
- Audited interpolation sites: `cloneRepoIntoSubdir()` (clone URL, branch, path), `setupWorkspace()` (branch checkout, directory creation), push/diff helpers (branch names).

**Alternatives considered**:
- Add argv mode to sandbox exec: Better long-term but out of scope; should be a separate sandbox enhancement.
- Template tag library: Non-standard, harder to audit than a single escape function.
- Deny special characters in branch names: Too restrictive — real repos have branches like `feat/user's-fix` or `bugfix/issue#42`.

### R5: Subagent signal propagation — what the agentLoop already accepts

**Decision**: Pass `signal`, `recorder`, `secrets`, and `resultStore` from parent to child `agentLoop()`.

**Rationale**: The `agentLoop` function already accepts all these parameters. The `taskTool` constructor simply doesn't wire them through.

**Key findings**:
- `agentLoop()` params (from `loop.ts` line 131): `signal`, `recorder`, `secrets`, `resultStore`, `onToken`, `shouldAbort`, `onSteeringCheck`, `onStep`.
- Subagent should receive: `signal` (abort), `recorder` (observability), `secrets` (redaction), `resultStore` (compaction).
- Subagent should NOT receive: `shouldAbort` (parent-specific Redis polling), `onSteeringCheck` (parent-specific steering), `onStep` (parent's persistence callback).
- `onToken` is optional — subagent tokens streaming to parent would create noise. Omit for now.
- The `taskTool` function currently receives 5 params. Adding a 6th `parentSignals` object keeps the interface clean without breaking the existing call site.

**Alternatives considered**:
- Create a child ObservabilityRecorder: Over-engineers; parent recorder is safe for single-threaded Bun.
- Pass full parent params object: Tight coupling; explicit parameters are clearer about what the child receives.
- Make signals global/module-level: Violates DI pattern; would conflict with concurrent subagents.

### R6: Bun test runner capabilities for apps/agent

**Decision**: Use Bun's built-in test runner (`bun test`). No additional frameworks.

**Rationale**: The monorepo already uses `bun test tests` at the root level. Bun's test runner is feature-complete for unit and integration testing.

**Key findings**:
- Supports `describe`, `it`/`test`, `expect` with rich matchers.
- Supports `beforeEach`/`afterEach`/`beforeAll`/`afterAll` lifecycle hooks.
- Mocking: `mock.module()` for module mocking, `spyOn` for function spying.
- TypeScript native — no compilation step.
- File-level parallelism by default.
- Test files: `.test.ts` suffix, placed under `apps/agent/tests/`.
- Need to add `"test": "bun test tests"` to `apps/agent/package.json`.
- Tests should focus on pure logic (mergeToolResults, sanitizeMetadata, shellEscape, URL safety) where mocking is minimal, plus mock-based tests for flush behavior and prompt assembly.

**Alternatives considered**:
- Vitest: More features (watch mode, coverage) but adds a dependency.
- Jest: Heavier, requires configuration, not aligned with Bun ecosystem.

### R7: Documentation audit — what specifically is stale in README.md

**Decision**: Full rewrite of `apps/agent/README.md`.

**Findings** — current inaccuracies:

| Line/Claim | Current (Wrong) | Actual |
|---|---|---|
| Line 1 description | "via Vercel AI SDK" | Direct `fetch` calls against Anthropic/OpenAI APIs |
| Line 22 | "through `@openforge/platform` event publishing" | `@coding-agents/platform` |
| Lines 34–38 dependencies | `@openforge/platform`, `@openforge/db`, `@openforge/sandbox`, `@openforge/shared`, `@openforge/skills` | `@coding-agents/platform`, `@coding-agents/db`, `@coding-agents/sandbox`, `@coding-agents/shared`; no `skills` package |
| Lines 42–43 notable deps | `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai` | Not in `package.json`; not used in implementation |

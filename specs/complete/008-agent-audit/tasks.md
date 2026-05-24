# Tasks: Agent Module Audit Remediation

**Input**: Design documents from `specs/008-agent-audit/`

**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Included — FR-011 explicitly requires test coverage for critical paths.

**Organization**: Tasks grouped by user story. US2/US3 (both P1 data-loss bugs) share a phase since they're small independent fixes in separate files.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Test Infrastructure)

**Purpose**: Establish test infrastructure for `apps/agent` — currently has zero test files.

- [ ] T001 Add `"test": "bun test tests"` script to `apps/agent/package.json`
- [ ] T002 Create `apps/agent/tests/` directory with an empty smoke test file `apps/agent/tests/smoke.test.ts` that verifies `bun test` runs

**Checkpoint**: `cd apps/agent && bun test tests` executes and passes.

---

## Phase 2: Foundational (Shell Escape Utility)

**Purpose**: Create the `shellEscape` utility needed by US4 (decomposition) and US5 (shell safety). Must complete before those phases.

- [ ] T003 Create `shellEscape()` function in `apps/agent/src/lib/shell-escape.ts` per contract: POSIX single-quote wrapping, null-byte rejection, empty-string handling
- [ ] T004 [P] Write tests for `shellEscape()` in `apps/agent/tests/shell-escape.test.ts` covering: plain strings, embedded single quotes, shell metacharacters (`$()`, backticks, pipes), empty string, null bytes (expect throw)

**Checkpoint**: `shellEscape` utility exists and all edge-case tests pass.

---

## Phase 3: User Story 2 & 3 — Data-Loss Bug Fixes (Priority: P1) 🎯 MVP

**Goal**: Fix two data-loss bugs: observability flush drops queued events on failure (US2), and `mergeToolResults` silently drops unmatched tool_result parts (US3).

**Independent Test (US2)**: Mock `recordBatch()` to fail, verify events remain in queue for retry on next flush.

**Independent Test (US3)**: Pass parts with an unmatched `tool_result`, verify it appears in output.

### Tests

- [ ] T005 [P] [US2] Write tests for `flushNow()` requeue behavior in `apps/agent/tests/observability.test.ts`: (1) successful flush removes items, (2) failed `recordBatch` keeps items in queue, (3) failed `exportBatch` keeps spans in queue, (4) subsequent flush retries previously-failed items
- [ ] T006 [P] [US3] Write tests for `mergeToolResults()` in `apps/agent/tests/run-persistence.test.ts`: (1) matched tool_call + tool_result merges correctly, (2) unmatched tool_result is appended (not dropped), (3) text parts pass through, (4) ordering edge case — tool_result before tool_call, (5) duplicate toolCallId handling

### Implementation

- [ ] T007 [P] [US2] Fix `flushNow()` in `apps/agent/src/observability.ts`: replace `splice`-before-try with `slice`-then-`splice`-on-success for both `queue` and `spans` arrays. Keep `flushInFlight` guard. Update warn messages to say "will retry"
- [ ] T008 [P] [US3] Fix `mergeToolResults()` in `apps/agent/src/run-persistence.ts`: in the `tool_result` branch, append unmatched parts to `merged` array instead of silently dropping them

**Checkpoint**: Both data-loss bugs fixed. Tests verify requeue-on-failure and no silent drops. `bun test tests/observability.test.ts tests/run-persistence.test.ts` passes.

---

## Phase 4: User Story 1 — Agent Skills Are Applied During Sessions (Priority: P1)

**Goal**: Resolved skill content is actually injected into the agent system prompt, and `resolveJobSkills()` passes meaningful context instead of empty strings.

**Independent Test**: Call `buildAgentSystemPrompt` with `resolvedSkillContents` and verify the output contains `# Skill:` sections with full markdown content.

### Tests

- [ ] T009 [P] [US1] Write tests for skill content injection in `apps/agent/tests/system-prompt.test.ts`: (1) `resolvedSkillContents` produces `# Skill: {slug}` sections in output, (2) empty `resolvedSkillContents` produces no skill sections, (3) `skillIndex` table still renders correctly alongside content, (4) scratch mode excludes skill content, (5) `projectContext` and `projectConfig.instructions` still injected correctly

### Implementation

- [ ] T010 [US1] Add `resolvedSkillContents` field to `SystemPromptOpts` interface in `apps/agent/src/system-prompt.ts` and inject content after the skill index table as `# Skill: {slug}` sections
- [ ] T011 [US1] Update `resolveJobSkills()` in `apps/agent/src/worker.ts` to pass `job.forgeUsername ?? ""` and `job.repos?.[0]?.repoPath ?? ""` instead of empty strings
- [ ] T012 [US1] Update the system prompt construction call site in `apps/agent/src/agent.ts` (the `runTurn` / prompt-building section) to pass `resolvedSkillContents` from `job.resolvedSkills` — map skills with non-empty `.content` to `{ slug, content }` objects

**Checkpoint**: Skills configured for a workspace are injected into the agent system prompt. `bun test tests/system-prompt.test.ts` passes.

---

## Phase 5: User Story 5 — Shell Commands Are Injection-Safe (Priority: P2)

**Goal**: All shell command interpolation sites in workspace setup use `shellEscape()` for safety.

**Independent Test**: Grep `apps/agent/src/` for string interpolation in `exec`/`bash` command construction and confirm all dynamic variables use `shellEscape()`.

### Implementation

- [ ] T013 [US5] Audit all shell command interpolation sites in `apps/agent/src/agent.ts` — identify every `adapter.exec()` or bash command that interpolates `repoPath`, `branchName`, `baseBranch`, `cloneUrl`, or workspace paths
- [ ] T014 [US5] Apply `shellEscape()` to all identified interpolation sites in `apps/agent/src/agent.ts`: import from `./lib/shell-escape` and wrap each interpolated variable in workspace setup, clone, push, and diff command strings
- [ ] T015 [US5] Where git operations use bash strings, convert to use the sandbox `/git` endpoint (argv execution) instead, if the operation is a simple git subcommand

**Checkpoint**: All dynamic values in shell commands are escaped. No raw string interpolation of user-controlled values into bash commands.

---

## Phase 6: User Story 4 — Agent Module Is Maintainable (Priority: P2)

**Goal**: Decompose `agent.ts` from ~1,100 lines into three focused modules: `workspace.ts`, `pr-manager.ts`, `turn-orchestrator.ts`.

**Independent Test**: `worker.ts` still imports and calls `runAgentTurn()` unchanged; `bun run typecheck` passes.

**⚠️ Depends on**: Phase 5 (shell escape applied to workspace commands before extraction).

### Implementation

- [ ] T016 [US4] Extract workspace setup functions from `apps/agent/src/agent.ts` to `apps/agent/src/workspace.ts`: `setupWorkspace()`, `setupScratchWorkspace()`, `cloneRepoIntoSubdir()`, multi-repo worktree setup, mirror fallback logic. Preserve all function signatures and parameter objects.
- [ ] T017 [US4] Extract PR management functions from `apps/agent/src/agent.ts` to `apps/agent/src/pr-manager.ts`: `createPrsForChangedRepos()`, `getDiffStats()`, push-and-create-PR helpers. Preserve all function signatures.
- [ ] T018 [US4] Extract turn orchestration into `apps/agent/src/turn-orchestrator.ts`: move `runAgentTurn()` and its direct helpers. Update imports to reference `workspace.ts` and `pr-manager.ts`.
- [ ] T019 [US4] Reduce `apps/agent/src/agent.ts` to a thin re-export: `export { runAgentTurn } from "./turn-orchestrator"`. Verify `worker.ts` import path (`./agent`) still resolves correctly.
- [ ] T020 [US4] Run `bun run typecheck` in `apps/agent/` and fix any import or type errors introduced by the decomposition

**Checkpoint**: `agent.ts` is <100 lines. All functions preserved with identical signatures. `bun run typecheck` passes. `worker.ts` calls `runAgentTurn()` unchanged.

---

## Phase 7: User Story 6 — Subagent Inherits Parent Safety Controls (Priority: P2)

**Goal**: `taskTool()` forwards parent abort signal, observability recorder, secret redaction map, and result store to the child `agentLoop()`.

**Independent Test**: Create a subagent with an already-aborted signal and verify the child loop exits immediately.

### Implementation

- [ ] T021 [US6] Add optional `parentSignals` parameter to `taskTool()` in `apps/agent/src/tools/task.ts` per contract: `{ signal?, recorder?, secrets?, resultStore? }`
- [ ] T022 [US6] Forward `parentSignals` fields to the child `agentLoop()` call inside `taskTool`'s `execute` function: pass `signal`, `recorder`, `secrets`, and `resultStore`
- [ ] T023 [US6] Update the `taskTool()` call site in `apps/agent/src/agent.ts` (or `turn-orchestrator.ts` post-decomposition) to pass the parent's `signal`, `recorder`, `secrets`, and `resultStore` as `parentSignals`

**Checkpoint**: Subagent receives parent abort signal, observability recorder, secret redactions, and result store. Type check passes.

---

## Phase 8: User Story 8 — Forge Provider Respects Session Type (Priority: P3)

**Goal**: `getForgeProviderForSession()` uses the session's declared forge type instead of hardcoding `"github"`.

**Independent Test**: Pass a session with `forgeType: "gitlab"` and verify the DB query uses `"gitlab"` (not `"github"`).

### Implementation

- [ ] T024 [US8] Update `getForgeProviderForSession()` in `apps/agent/src/providers.ts`: change the `syncConnections.provider` filter from hardcoded `"github"` to `session.forgeType ?? "github"`

**Checkpoint**: Provider query is parameterized. Existing behavior unchanged for `forgeType: "github"` or `forgeType: null`.

---

## Phase 9: User Story 7 — Documentation Matches Implementation (Priority: P3)

**Goal**: `apps/agent/README.md` accurately reflects the current implementation.

**Independent Test**: `grep -r '@openforge' apps/agent/` and `grep -r 'Vercel AI SDK' apps/agent/` both return no matches.

### Implementation

- [ ] T025 [US7] Rewrite `apps/agent/README.md`: replace "Vercel AI SDK" with "direct fetch calls against Anthropic/OpenAI APIs", replace all `@openforge/*` with `@coding-agents/*`, remove `@openforge/skills` (doesn't exist), remove `ai`/`@ai-sdk/*` from notable dependencies, update architecture description to match actual worker → loop → tool → sandbox pipeline

**Checkpoint**: README contains zero stale references. All package names, dependency lists, and architecture descriptions match reality.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Additional test coverage and final verification across all changes.

- [ ] T026 [P] Write URL safety tests in `apps/agent/tests/url-safety.test.ts`: private IP detection, SSRF hardening, port restrictions, redirect validation against `isUrlSafe()` and related functions
- [ ] T027 [P] Write agent loop tests in `apps/agent/tests/loop.test.ts`: step limit enforcement, empty response retry, abort signal handling (mock LLM provider returning controlled responses)
- [ ] T028 Run full verification checklist from `specs/008-agent-audit/quickstart.md`: `bun test tests` passes, `bun run typecheck` passes, `agent.ts` <100 lines, zero `@openforge` references, zero `Vercel AI SDK` references, `shellEscape` usage confirmed in workspace commands
- [ ] T029 Run `bun run typecheck` from monorepo root to verify no cross-package regressions

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — creates `shellEscape` utility
- **US2+US3 Data-Loss Fixes (Phase 3)**: Depends on Setup only — can start after Phase 1
- **US1 Skill Resolution (Phase 4)**: Depends on Setup only — can start after Phase 1
- **US5 Shell Safety (Phase 5)**: Depends on Phase 2 (`shellEscape` utility)
- **US4 Decomposition (Phase 6)**: Depends on Phase 5 (shell escape applied before extraction)
- **US6 Subagent Signals (Phase 7)**: Depends on Setup only — can start after Phase 1 (update call site after Phase 6 if decomposition done first)
- **US8 Forge Provider (Phase 8)**: Depends on Setup only — independent
- **US7 Documentation (Phase 9)**: Depends on Setup only — independent
- **Polish (Phase 10)**: Depends on all preceding phases

### User Story Dependencies

- **US2 (P1)**: Independent — `observability.ts` only
- **US3 (P1)**: Independent — `run-persistence.ts` only
- **US1 (P1)**: Independent — `system-prompt.ts`, `worker.ts`, prompt call site
- **US5 (P2)**: Depends on Phase 2 (shellEscape utility)
- **US4 (P2)**: Depends on US5 (shell escape applied before decomposition)
- **US6 (P2)**: Independent, but call site update depends on US4 if decomposition done first
- **US8 (P3)**: Independent — `providers.ts` only
- **US7 (P3)**: Independent — `README.md` only

### Parallel Opportunities

After Phase 1 (Setup) completes, the following can run in parallel:

```
Phase 2 (shellEscape)  |  Phase 3 (US2+US3)  |  Phase 4 (US1)  |  Phase 7 (US6)  |  Phase 8 (US8)  |  Phase 9 (US7)
         ↓
   Phase 5 (US5)
         ↓
   Phase 6 (US4)
         ↓
  Phase 10 (Polish)
```

### Within Each User Story

- Tests written first (where included)
- Implementation follows
- Verification at checkpoint

---

## Parallel Example: Maximum Parallelism After Phase 1

```text
# After Phase 1 setup completes, launch all independent work:

Agent A: T003, T004 (Phase 2 — shellEscape)
Agent B: T005, T007 (Phase 3 — US2 observability fix + test)
Agent C: T006, T008 (Phase 3 — US3 merge fix + test)
Agent D: T009, T010, T011, T012 (Phase 4 — US1 skill resolution)
Agent E: T021, T022 (Phase 7 — US6 subagent signals)
Agent F: T024 (Phase 8 — US8 forge provider)
Agent G: T025 (Phase 9 — US7 documentation)
```

After Agent A finishes, US5 (T013–T015) and then US4 (T016–T020) proceed sequentially.

---

## Implementation Strategy

### MVP First (US2 + US3 — Data-Loss Fixes)

1. Complete Phase 1: Setup (test infrastructure)
2. Complete Phase 3: US2 + US3 (fix both data-loss bugs)
3. **STOP and VALIDATE**: Both fixes verified by tests
4. These are the highest-impact, lowest-risk changes

### Incremental Delivery

1. Setup + Foundational → test infra + shellEscape ready
2. US2 + US3 → data-loss bugs fixed → verify tests pass
3. US1 → skill resolution fixed → verify system prompt contains skill content
4. US5 → shell commands hardened → verify shellEscape usage
5. US4 → agent.ts decomposed → verify <100 lines, typecheck passes
6. US6 → subagent signals wired → verify abort propagation
7. US8 + US7 → forge type + docs → verify no stale references
8. Polish → remaining tests + full verification

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Total: 29 tasks across 10 phases
- All changes stay within `apps/agent` — no cross-package modifications
- `agent.ts` re-export ensures `worker.ts` import path is backward compatible

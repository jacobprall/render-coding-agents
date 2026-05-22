# Feature Specification: Agent Module Audit Remediation

**Feature Branch**: `008-agent-audit`

**Created**: 2026-05-22

**Status**: Draft

**Input**: Nine weaknesses identified in the `apps/agent` module audit (audit.md lines 138–146). Covers skill resolution drift, god-module decomposition, shell command safety, test coverage, documentation staleness, GitHub-only forge wiring, uncontrolled subagent execution, observability data loss, and tool-result merge drops.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent Skills Are Applied During Sessions (Priority: P1)

A developer configures skills for a workspace. When an agent session starts, the resolved skill content is injected into the agent's system prompt so the agent actually follows the skill guidance.

**Why this priority**: Skill resolution is currently broken — skills are resolved but never injected. This means workspace skill configuration has no effect on agent behavior, which is a user-visible functional gap.

**Independent Test**: Configure a workspace with a skill, start a session, and verify via observability events or prompt inspection that the skill content appears in the system prompt.

**Acceptance Scenarios**:

1. **Given** a workspace has skills configured and resolved, **When** an agent session starts, **Then** the full markdown content of each resolved skill is included in the system prompt.
2. **Given** `resolveJobSkills()` is called, **When** the job has `forgeUsername` and repo context, **Then** user and repo skills resolve with correct context (not empty strings).
3. **Given** no skills are configured, **When** an agent session starts, **Then** the system prompt contains no skill sections (no regression).

---

### User Story 2 - Observability Data Survives Transient Failures (Priority: P1)

An operator monitors agent sessions via the observability dashboard. When the observability backend has a transient failure, queued events are retried on the next flush cycle instead of being permanently lost.

**Why this priority**: Data loss in the observability pipeline undermines debugging and audit capabilities — a direct violation of Constitution Principle II (Observability).

**Independent Test**: Mock `recordBatch()` to fail on the first call and succeed on the second. Verify all events are persisted after the retry.

**Acceptance Scenarios**:

1. **Given** `flushNow()` is called and `recordBatch()` throws, **When** the next flush cycle runs, **Then** the previously-failed events are included in the retry batch.
2. **Given** `flushNow()` is called and `exportBatch()` (OTLP) throws, **When** the next flush cycle runs, **Then** the previously-failed spans are included in the retry batch.
3. **Given** `flushNow()` succeeds, **When** the flush completes, **Then** flushed items are removed from the queue (no duplication).

---

### User Story 3 - Tool Results Are Never Silently Dropped (Priority: P1)

A developer reviews a session's chat history. All tool results are preserved, even if persistence ordering produces a `tool_result` before its corresponding `tool_call`.

**Why this priority**: Silent data loss in chat history is a correctness bug that can make sessions appear incomplete or broken.

**Acceptance Scenarios**:

1. **Given** parts contain a `tool_result` with a matching `tool_call`, **When** `mergeToolResults()` runs, **Then** the result is merged into the tool_call entry.
2. **Given** parts contain a `tool_result` with NO matching `tool_call`, **When** `mergeToolResults()` runs, **Then** the result is appended to the output (not dropped).

---

### User Story 4 - Agent Module Is Maintainable (Priority: P2)

A contributor needs to modify workspace setup logic. The relevant code is in a focused module (`workspace.ts`) rather than buried in a 1,100-line god module, reducing cognitive load and change risk.

**Acceptance Scenarios**:

1. **Given** the decomposition is complete, **When** a contributor looks for workspace setup logic, **Then** it lives in `workspace.ts` (not `agent.ts`).
2. **Given** the decomposition is complete, **When** a contributor looks for PR creation logic, **Then** it lives in `pr-manager.ts`.
3. **Given** `agent.ts` is decomposed, **Then** `worker.ts` still calls `runAgentTurn()` with no signature changes.

---

### User Story 5 - Shell Commands Are Injection-Safe (Priority: P2)

An agent session processes a repository with special characters in branch names or paths. Shell commands in workspace setup use proper escaping or argv-style execution, preventing injection.

**Acceptance Scenarios**:

1. **Given** a repo branch name contains shell metacharacters (e.g., `feat/user's-fix`), **When** workspace setup runs, **Then** the command executes correctly without injection.
2. **Given** a `shellEscape()` helper exists, **When** called with arbitrary input, **Then** it produces a POSIX-safe single-quoted literal.

---

### User Story 6 - Subagent Inherits Parent Safety Controls (Priority: P2)

A parent agent spawns a subagent via `taskTool()`. The subagent respects the parent's abort signal, has its events recorded in observability, and has secrets redacted from its tool outputs.

**Acceptance Scenarios**:

1. **Given** a parent agent spawns a subagent, **When** the parent is aborted, **Then** the subagent also aborts.
2. **Given** a subagent executes tools, **When** tool outputs contain secrets, **Then** secrets are redacted before entering the subagent's LLM context.
3. **Given** a subagent executes, **When** it records observability events, **Then** events appear under the parent's trace.

---

### User Story 7 - Documentation Matches Implementation (Priority: P3)

A new contributor reads `apps/agent/README.md`. The documentation accurately describes the implementation: package names, dependencies, and architecture.

**Acceptance Scenarios**:

1. **Given** the README is updated, **Then** it references `@coding-agents/*` (not `@openforge/*`).
2. **Given** the README is updated, **Then** it describes direct fetch LLM calls (not Vercel AI SDK).
3. **Given** the README is updated, **Then** listed dependencies match `package.json`.

---

### User Story 8 - Forge Provider Respects Session Type (Priority: P3)

An agent session declares a forge type. `getForgeProviderForSession()` queries sync connections using the session's declared forge type instead of hardcoding `"github"`.

**Acceptance Scenarios**:

1. **Given** a session has `forgeType: "github"`, **When** `getForgeProviderForSession()` runs, **Then** it queries for provider `"github"`.
2. **Given** a session has `forgeType: "gitlab"` (future), **When** `getForgeProviderForSession()` runs, **Then** it queries for provider `"gitlab"` (not `"github"`).
3. **Given** a session has `forgeType: null`, **When** `getForgeProviderForSession()` runs, **Then** it falls back to `"github"`.

---

### Edge Cases

- What happens when `flushNow()` fails repeatedly and the queue hits `eventCap`? (Resolved: new events are rejected by `canRecordMore()`, existing behavior.)
- What happens when `mergeToolResults()` receives duplicate `tool_call` IDs? (First one wins, subsequent calls with same ID overwrite.)
- What happens when `shellEscape()` receives a string with null bytes? (Throw — null bytes are invalid in shell arguments.)
- What happens when the subagent's abort signal fires mid-tool-execution? (The tool's current operation completes, then the loop exits on the next iteration check.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST inject resolved skill content into the agent system prompt, not just skill summary metadata.
- **FR-002**: `resolveJobSkills()` MUST pass meaningful `forgeUsername` and `projectRepoPath` from the job payload.
- **FR-003**: `ObservabilityRecorder.flushNow()` MUST NOT permanently lose queued events/spans on transient backend failures.
- **FR-004**: `mergeToolResults()` MUST preserve `tool_result` parts that have no matching `tool_call`.
- **FR-005**: `agent.ts` MUST be decomposed into focused modules: workspace setup, PR management, and turn orchestration.
- **FR-006**: Shell commands in workspace setup MUST use proper escaping or argv-style execution for interpolated variables.
- **FR-007**: `taskTool()` MUST forward the parent abort signal to the child `agentLoop()`.
- **FR-008**: `taskTool()` MUST forward the parent's observability recorder and secret redaction map to the child `agentLoop()`.
- **FR-009**: `getForgeProviderForSession()` MUST use the session's declared forge type instead of hardcoding `"github"`.
- **FR-010**: `apps/agent/README.md` MUST accurately describe the current implementation.
- **FR-011**: `apps/agent` MUST have test coverage for `mergeToolResults()`, `flushNow()`, URL safety, shell escaping, and system prompt assembly.

### Key Entities

- **ObservabilityRecorder**: Batched event recorder with periodic flush and requeue-on-failure.
- **AssistantPart**: Union type for chat message parts (text, tool_call, tool_result, etc.).
- **SystemPromptOpts**: Configuration object for system prompt assembly, extended with resolved skill contents.
- **AgentJob**: Queued work payload with resolved skills, forge context, and repo metadata.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero data loss in `flushNow()` — all events eventually persisted or explicitly capped (verified by test).
- **SC-002**: Zero silent drops in `mergeToolResults()` — all input parts appear in output (verified by test).
- **SC-003**: `agent.ts` reduced from ~1,100 lines to <100 lines (re-exports/orchestration only).
- **SC-004**: All shell command interpolation sites use `shellEscape()` or argv execution (verified by grep audit).
- **SC-005**: Subagent abort propagation verified by test (parent abort → child loop exits).
- **SC-006**: Test suite passes with `bun test` — minimum 6 test files covering critical paths.
- **SC-007**: README contains zero references to `@openforge/*` or "Vercel AI SDK".

## Assumptions

- The existing `agentLoop()` function signature (which already accepts `signal`, `recorder`, `secrets`, `resultStore`) does not need modification.
- Bun's built-in test runner is sufficient for all test cases (no additional test framework needed).
- The decomposition of `agent.ts` preserves all existing function signatures — `worker.ts` continues to call `runAgentTurn()` unchanged.
- The forge provider fix (using `session.forgeType`) is a minimal change; full multi-provider support is deferred to a separate spec.
- No database schema changes are required — all changes are internal to `apps/agent`.

# Quickstart: Agent Module Audit Remediation

**Date**: 2026-05-22 | **Feature**: 008-agent-audit

## Prerequisites

- Bun 1.2+ installed
- Repository cloned and dependencies installed (`bun install` from repo root)
- No infrastructure needed (all changes are in `apps/agent` source code and tests)

## Development Workflow

### Running the agent worker (for manual verification)

```bash
# From repo root — requires Redis and Postgres running
bun run infra:up
bun run db:push
bun run worker
```

### Running tests

```bash
# Run all agent tests
cd apps/agent && bun test tests

# Run a specific test file
cd apps/agent && bun test tests/run-persistence.test.ts

# Run from repo root (after adding to turbo pipeline)
bun run test
```

### Type checking

```bash
cd apps/agent && bun run typecheck
```

## Workstream Order

The workstreams can be executed largely in parallel. Recommended order for sequential work:

1. **WS-1**: Data-loss bug fixes (observability.ts, run-persistence.ts) — smallest, highest priority
2. **WS-2**: Skill resolution fix (worker.ts, system-prompt.ts) — small, high priority
3. **WS-5**: Subagent signal propagation (tools/task.ts) — small, independent
4. **WS-4**: Shell command safety (lib/shell-escape.ts, workspace setup paths) — medium
5. **WS-3**: Agent.ts decomposition — largest change, benefits from WS-4 being done first
6. **WS-6**: Tests and documentation — can start any time, finalize last

### For parallel execution

- WS-1, WS-2, WS-5 have no interdependencies
- WS-4 should complete before WS-3 (decomposition uses the new shell escape utility)
- WS-6 tests can be written against the current code first, then updated during/after decomposition

## Key Files to Read First

| File | Why |
|------|-----|
| `apps/agent/src/observability.ts` lines 220–244 | The flush bug (issue 8) |
| `apps/agent/src/run-persistence.ts` lines 42–61 | The merge bug (issue 9) |
| `apps/agent/src/system-prompt.ts` lines 147–190 | Where skill content should be injected (issue 1) |
| `apps/agent/src/worker.ts` lines 182–209 | Where skills are resolved with empty context (issue 1) |
| `apps/agent/src/providers.ts` lines 19–36 | Hardcoded "github" provider (issue 6) |
| `apps/agent/src/tools/task.ts` lines 35–91 | Subagent missing parent signals (issue 7) |
| `apps/agent/src/agent.ts` | The god module to decompose (issue 2) |
| `apps/agent/src/loop.ts` lines 131–148 | `agentLoop` params — what the subagent should forward |

## Verification Checklist

After all workstreams complete:

- [ ] `bun test tests` passes in `apps/agent/`
- [ ] `bun run typecheck` passes in `apps/agent/`
- [ ] `agent.ts` is <100 lines (re-export only)
- [ ] `grep -r '@openforge' apps/agent/` returns no matches
- [ ] `grep -r 'Vercel AI SDK' apps/agent/` returns no matches
- [ ] `grep -rn 'provider.*"github"' apps/agent/src/providers.ts` shows parameterized query
- [ ] `grep -rn 'shellEscape' apps/agent/src/` shows usage in workspace setup commands

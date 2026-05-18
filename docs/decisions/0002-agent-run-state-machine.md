# ADR-0002: Explicit state machine for agent_runs

**Status:** Accepted  
**Date:** 2026-05-17

## Context

`agent_runs.status` was mutated in at least four different files:

- `apps/agent/src/index.ts` (worker loop)
- `packages/platform/src/services/session.ts`
- `packages/platform/src/inbound/dispatcher.ts` (coalesce cancellation)
- `apps/web/...` (user-initiated abort)

Each site set `status` to a string literal and hoped the value was valid for the current state. There was no central definition of which transitions were legal, meaning:
- Invalid transitions (e.g., `completed → running`) were possible and silent
- Adding a new terminal state required hunting all mutation sites
- Code review couldn't verify correctness without reading all usages

## Decision

Add `AgentRunStateMachine` in `packages/platform/src/state-machine.ts`.

```typescript
const machine = new AgentRunStateMachine();
const next = machine.transition("queued", "run.started"); // → "running"
machine.canTransition("completed", "run.started");        // → false
machine.isTerminal("completed");                          // → true
```

Valid transition table:

| From → Event | Next state |
|---|---|
| `queued` + `run.started` | `running` |
| `queued` + `run.aborted` | `aborted` |
| `running` + `run.completed` | `completed` |
| `running` + `run.aborted` | `aborted` |
| `running` + `run.failed` | `failed` |
| `running` + `run.errored` | `error` |

All four terminal states (`completed`, `aborted`, `failed`, `error`) have no outgoing transitions.

An exported singleton `runStateMachine` is ready to use without instantiation.

## Consequences

**Good:**
- Single source of truth for valid transitions
- `InvalidRunTransitionError` surfaces bugs (e.g., re-queuing a completed run) at the point of mutation rather than silently corrupting state
- Easy to extend: adding a new event type requires one file change and one table row

**Required follow-up:**
- Existing mutation sites should be updated to call `runStateMachine.transition()` instead of assigning status strings directly. The state machine is available but not yet enforced at every mutation site — enforcement is opt-in during migration.

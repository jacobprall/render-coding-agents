/**
 * AgentRunStateMachine — validates and enforces transitions for agent_runs.status.
 *
 * Centralising transitions here means:
 *   - No scattered ad-hoc status mutations across services
 *   - Invalid transitions are caught and logged as bugs rather than silently
 *     corrupting state
 *   - Adding new states/events requires exactly one file change
 */

export type AgentRunStatus =
  | "queued"    // enqueued, waiting for a worker
  | "running"   // picked up by a worker
  | "paused"    // user requested a pause — agent will finish current step then idle
  | "completed" // finished successfully
  | "aborted"   // cancelled by a coalesce / user request before completion
  | "failed"    // unrecoverable runtime error
  | "error";    // infrastructure error (queue dead-letter, timeout)

/** Lifecycle events that drive status transitions */
export type AgentRunEvent =
  | "run.started"    // worker claimed the job
  | "run.paused"     // user requested pause
  | "run.resumed"    // user requested resume from paused state
  | "run.completed"  // agent finished naturally
  | "run.aborted"    // cancelled externally (user, coalesce)
  | "run.failed"     // agent threw an unrecoverable error
  | "run.errored";   // infrastructure-level error (dead-letter, timeout)

// ---------------------------------------------------------------------------
// Valid transition table
// ---------------------------------------------------------------------------

const TRANSITIONS: Readonly<Record<AgentRunStatus, Readonly<Partial<Record<AgentRunEvent, AgentRunStatus>>>>> = {
  queued: {
    "run.started":   "running",
    "run.aborted":   "aborted",   // cancelled before a worker picks it up
  },
  running: {
    "run.paused":    "paused",
    "run.completed": "completed",
    "run.aborted":   "aborted",
    "run.failed":    "failed",
    "run.errored":   "error",
  },
  paused: {
    "run.resumed":   "running",
    "run.aborted":   "aborted",   // can cancel while paused
    "run.completed": "completed", // can complete if last step finished before pause took effect
  },
  // Terminal states — no transitions out
  completed: {},
  aborted:   {},
  failed:    {},
  error:     {},
};

// ---------------------------------------------------------------------------
// StateMachine class
// ---------------------------------------------------------------------------

export class AgentRunStateMachine {
  /**
   * Compute the next status for an event.
   * Returns the new status, or throws if the transition is invalid.
   */
  transition(current: AgentRunStatus, event: AgentRunEvent): AgentRunStatus {
    const next = TRANSITIONS[current]?.[event];
    if (!next) {
      throw new InvalidRunTransitionError(current, event);
    }
    return next;
  }

  /**
   * Returns true if the event is a valid transition from the current status.
   */
  canTransition(current: AgentRunStatus, event: AgentRunEvent): boolean {
    return !!TRANSITIONS[current]?.[event];
  }

  /**
   * Returns true if the status is terminal (no further transitions possible).
   */
  isTerminal(status: AgentRunStatus): boolean {
    return Object.keys(TRANSITIONS[status] ?? {}).length === 0;
  }
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class InvalidRunTransitionError extends Error {
  constructor(
    public readonly currentStatus: AgentRunStatus,
    public readonly event: AgentRunEvent,
  ) {
    super(
      `Invalid agent run transition: cannot apply "${event}" to status "${currentStatus}"`,
    );
    this.name = "InvalidRunTransitionError";
  }
}

/** Singleton — safe to import directly in services */
export const runStateMachine = new AgentRunStateMachine();

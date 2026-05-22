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

export type TerminalReason =
  | "end_turn"
  | "step_limit"
  | "stopped"
  | "timeout"
  | "coalesced"
  | "worker_lost"
  | "empty_response"
  | "provider_transient"
  | "provider_fatal"
  | "tool_fatal"
  | "internal"
  | "max_tokens";

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

/** Pairs inferred from TRANSITIONS for direct status→status validation at mutation sites */
const ALLOWED_STATUS_EDGES = (() => {
  const pairs = new Set<string>();
  for (const [from, byEvent] of Object.entries(TRANSITIONS) as [
    AgentRunStatus,
    (typeof TRANSITIONS)[AgentRunStatus],
  ][]) {
    for (const to of Object.values(byEvent)) {
      if (to !== undefined) pairs.add(`${from}\0${to}`);
    }
  }
  return pairs;
})();

/**
 * Validates a direct DB status mutation against the canonical transition graph.
 * No-op if `from === to`.
 */
export function assertValidTransition(
  from: AgentRunStatus,
  to: AgentRunStatus,
): void {
  if (from === to) return;
  if (!ALLOWED_STATUS_EDGES.has(`${from}\0${to}`)) {
    throw new InvalidRunTransitionError(from, to, "direct");
  }
}

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
  readonly event?: AgentRunEvent;
  readonly targetStatus?: AgentRunStatus;

  constructor(currentStatus: AgentRunStatus, event: AgentRunEvent);
  constructor(
    currentStatus: AgentRunStatus,
    targetStatus: AgentRunStatus,
    direct: "direct",
  );
  constructor(
    public readonly currentStatus: AgentRunStatus,
    second: AgentRunEvent | AgentRunStatus,
    direct?: "direct",
  ) {
    if (direct === "direct") {
      const to = second as AgentRunStatus;
      super(
        `Invalid agent run transition: cannot transition from "${currentStatus}" to "${to}"`,
      );
      this.targetStatus = to;
    } else {
      const event = second as AgentRunEvent;
      super(
        `Invalid agent run transition: cannot apply "${event}" to status "${currentStatus}"`,
      );
      this.event = event;
    }
    this.name = "InvalidRunTransitionError";
  }
}

/** Singleton — safe to import directly in services */
export const runStateMachine = new AgentRunStateMachine();

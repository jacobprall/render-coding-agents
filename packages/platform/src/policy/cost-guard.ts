import type { CostPermissions } from "./types";

// ---------------------------------------------------------------------------
// CostGuard — budget enforcement per-task and per-turn
// ---------------------------------------------------------------------------

export interface CostGuardState {
  taskTotalUsd: number;
  turnTotalUsd: number;
}

export type CostGuardDecision =
  | { action: "allow" }
  | { action: "warn"; message: string }
  | { action: "block"; message: string };

/**
 * Evaluate whether spending `additionalUsd` is permitted given the current
 * accumulated cost and the configured policy.
 */
export function evaluateCost(
  state: CostGuardState,
  additionalUsd: number,
  policy: CostPermissions,
): CostGuardDecision {
  const newTaskTotal = state.taskTotalUsd + additionalUsd;
  const newTurnTotal = state.turnTotalUsd + additionalUsd;

  // Per-turn hard limit
  if (policy.maxPerTurn > 0 && newTurnTotal > policy.maxPerTurn) {
    return {
      action: "block",
      message: `Turn cost limit exceeded: $${newTurnTotal.toFixed(4)} > $${policy.maxPerTurn.toFixed(4)}`,
    };
  }

  // Per-task hard limit
  if (policy.maxPerTask > 0 && newTaskTotal > policy.maxPerTask) {
    return {
      action: "block",
      message: `Task cost limit exceeded: $${newTaskTotal.toFixed(4)} > $${policy.maxPerTask.toFixed(4)}`,
    };
  }

  // Warn threshold (per-task)
  if (
    policy.maxPerTask > 0 &&
    policy.warnAt > 0 &&
    newTaskTotal >= policy.maxPerTask * policy.warnAt
  ) {
    return {
      action: "warn",
      message: `Task cost at ${(newTaskTotal / policy.maxPerTask * 100).toFixed(0)}% of budget ($${newTaskTotal.toFixed(4)} / $${policy.maxPerTask.toFixed(4)})`,
    };
  }

  return { action: "allow" };
}

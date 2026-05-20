import { eq, sql, and, gte } from "drizzle-orm";
import { llmCalls, budgets } from "@coding-agents/db";
import type { PlatformDb } from "../interfaces/database";
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

// ---------------------------------------------------------------------------
// canDispatch — monthly-budget check before dispatching an agent run
// ---------------------------------------------------------------------------

export interface CanDispatchResult {
  allowed: boolean;
  reason?: string;
  remainingBudget: number;
}

/**
 * Query `llm_calls` for current-month spend and compare against the user's
 * (or org's) budget. Returns whether a new dispatch should proceed.
 */
export async function canDispatch(
  db: PlatformDb,
  userId: string,
  orgId?: string,
): Promise<CanDispatchResult> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // Sum spend for this month
  const spendResult = await db
    .select({
      total: sql<number>`COALESCE(SUM(${llmCalls.costUsd}::numeric), 0)`,
    })
    .from(llmCalls)
    .where(
      and(eq(llmCalls.userId, userId), gte(llmCalls.createdAt, monthStart)),
    );

  const currentSpend = Number(spendResult[0]?.total ?? 0);

  // Look up budget — prefer user-level, fall back to org-level
  const conditions = orgId
    ? sql`${budgets.userId} = ${userId} OR ${budgets.orgId} = ${orgId}`
    : eq(budgets.userId, userId);

  const budgetRows = await db
    .select()
    .from(budgets)
    .where(conditions)
    .limit(2);

  // Prefer user-specific budget over org-wide
  const budget =
    budgetRows.find((b) => b.userId === userId) ??
    budgetRows.find((b) => b.orgId === orgId) ??
    null;

  if (!budget) {
    return { allowed: true, remainingBudget: Infinity };
  }

  const limit = Number(budget.monthlyLimitUsd);
  const remaining = Math.max(0, limit - currentSpend);

  if (remaining <= 0) {
    return {
      allowed: false,
      reason: `Monthly budget exhausted: $${currentSpend.toFixed(2)} spent of $${limit.toFixed(2)} limit`,
      remainingBudget: 0,
    };
  }

  return { allowed: true, remainingBudget: remaining };
}

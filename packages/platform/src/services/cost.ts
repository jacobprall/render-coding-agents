import { eq, sql, and, gte, lte } from "drizzle-orm";
import { llmCalls, budgets } from "@coding-agents/db";
import type { PlatformDb } from "../interfaces/database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageSummary {
  byModel: Array<{
    model: string;
    provider: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    callCount: number;
  }>;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface SpendCheckResult {
  allowed: boolean;
  remainingUsd: number;
  currentSpendUsd: number;
  monthlyLimitUsd: number | null;
}

// ---------------------------------------------------------------------------
// CostService
// ---------------------------------------------------------------------------

export class CostService {
  constructor(private db: PlatformDb) {}

  async getUsageSummary(
    userId: string,
    period: { from: Date; to: Date },
  ): Promise<UsageSummary> {
    const rows = await this.db
      .select({
        model: llmCalls.model,
        provider: llmCalls.provider,
        totalInputTokens: sql<number>`COALESCE(SUM(${llmCalls.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`COALESCE(SUM(${llmCalls.outputTokens}), 0)`,
        totalCostUsd: sql<number>`COALESCE(SUM(${llmCalls.costUsd}::numeric), 0)`,
        callCount: sql<number>`COUNT(*)`,
      })
      .from(llmCalls)
      .where(
        and(
          eq(llmCalls.userId, userId),
          gte(llmCalls.createdAt, period.from),
          lte(llmCalls.createdAt, period.to),
        ),
      )
      .groupBy(llmCalls.model, llmCalls.provider);

    const byModel = rows.map((r) => ({
      model: r.model,
      provider: r.provider,
      totalInputTokens: Number(r.totalInputTokens),
      totalOutputTokens: Number(r.totalOutputTokens),
      totalCostUsd: Number(r.totalCostUsd),
      callCount: Number(r.callCount),
    }));

    return {
      byModel,
      totalCostUsd: byModel.reduce((sum, m) => sum + m.totalCostUsd, 0),
      totalInputTokens: byModel.reduce((sum, m) => sum + m.totalInputTokens, 0),
      totalOutputTokens: byModel.reduce((sum, m) => sum + m.totalOutputTokens, 0),
    };
  }

  async getUserSpend(userId: string, month: Date): Promise<number> {
    const from = new Date(month.getFullYear(), month.getMonth(), 1);
    const to = new Date(month.getFullYear(), month.getMonth() + 1, 1);

    const result = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(${llmCalls.costUsd}::numeric), 0)`,
      })
      .from(llmCalls)
      .where(
        and(
          eq(llmCalls.userId, userId),
          gte(llmCalls.createdAt, from),
          lte(llmCalls.createdAt, to),
        ),
      );

    return Number(result[0]?.total ?? 0);
  }

  async canSpend(userId: string): Promise<SpendCheckResult> {
    const now = new Date();
    const currentSpendUsd = await this.getUserSpend(userId, now);

    const budgetRows = await this.db
      .select()
      .from(budgets)
      .where(eq(budgets.userId, userId))
      .limit(1);

    const budget = budgetRows[0];
    if (!budget) {
      return {
        allowed: true,
        remainingUsd: Infinity,
        currentSpendUsd,
        monthlyLimitUsd: null,
      };
    }

    const limit = Number(budget.monthlyLimitUsd);
    const remaining = Math.max(0, limit - currentSpendUsd);

    return {
      allowed: remaining > 0,
      remainingUsd: remaining,
      currentSpendUsd,
      monthlyLimitUsd: limit,
    };
  }
}

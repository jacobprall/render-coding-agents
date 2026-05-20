import { describe, it, expect, mock, beforeAll } from "bun:test";
import {
  calculateCost,
  MODEL_PRICING,
  type ModelPricing,
} from "../../packages/platform/src/policy/pricing";

mock.module("@coding-agents/db", () => ({
  llmCalls: { userId: "userId", createdAt: "createdAt", model: "model", provider: "provider", inputTokens: "inputTokens", outputTokens: "outputTokens", costUsd: "costUsd" },
  budgets: { userId: "userId", monthlyLimitUsd: "monthlyLimitUsd" },
}));

let CostService: typeof import("../../packages/platform/src/services/cost").CostService;
beforeAll(async () => {
  const mod = await import("../../packages/platform/src/services/cost");
  CostService = mod.CostService;
});

// ---------------------------------------------------------------------------
// calculateCost
// ---------------------------------------------------------------------------

describe("calculateCost", () => {
  it("computes correct cost for an exact model name", () => {
    const cost = calculateCost("claude-sonnet-4-20250514", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3 + 15, 6);
  });

  it("computes cost for gpt-4o model", () => {
    const cost = calculateCost("gpt-4o", 500_000, 200_000);
    expect(cost).toBeCloseTo((500_000 / 1_000_000) * 2.5 + (200_000 / 1_000_000) * 10, 6);
  });

  it("scales linearly with token count", () => {
    const base = calculateCost("o3", 100_000, 50_000);
    const doubled = calculateCost("o3", 200_000, 100_000);
    expect(doubled).toBeCloseTo(base * 2, 6);
  });

  it("returns 0 for an unknown model", () => {
    expect(calculateCost("totally-unknown-model", 100_000, 100_000)).toBe(0);
  });

  it("returns 0 when tokens are 0", () => {
    expect(calculateCost("gpt-4o", 0, 0)).toBe(0);
  });

  it("handles the haiku pricing correctly", () => {
    const cost = calculateCost("claude-haiku-4-5-20250514", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.8 + 4, 6);
  });
});

// ---------------------------------------------------------------------------
// Prefix matching for versioned model names
// ---------------------------------------------------------------------------

describe("calculateCost prefix matching", () => {
  it("matches claude-sonnet-4 without the date suffix", () => {
    const cost = calculateCost("claude-sonnet-4-new-version", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3 + 15, 6);
  });

  it("matches claude-opus-4 via prefix", () => {
    const cost = calculateCost("claude-opus-4-future", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(15 + 75, 6);
  });

  it("matches gpt-4o-mini via exact key", () => {
    const cost = calculateCost("gpt-4o-mini", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.15 + 0.6, 6);
  });

  it("matches o3-mini exactly", () => {
    const cost = calculateCost("o3-mini", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.1 + 4.4, 6);
  });
});

// ---------------------------------------------------------------------------
// CostService with mocked DB
// ---------------------------------------------------------------------------

function mockDb(options: {
  spendTotal?: number;
  budgetLimit?: number | null;
}) {
  const { spendTotal = 0, budgetLimit = null } = options;

  const chainable = {
    select: () => chainable,
    from: () => chainable,
    where: () => chainable,
    groupBy: () => chainable,
    limit: () => chainable,
    then: undefined as unknown,
  };

  let callIndex = 0;

  const db = {
    select(fields?: unknown) {
      const currentCall = callIndex++;
      const chain = {
        from: () => chain,
        where: () => chain,
        groupBy: () => chain,
        limit: () => chain,
        then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
          if (currentCall === 0) {
            resolve([{ total: spendTotal }]);
          } else {
            if (budgetLimit !== null) {
              resolve([{ monthlyLimitUsd: String(budgetLimit) }]);
            } else {
              resolve([]);
            }
          }
          return Promise.resolve();
        },
      };
      return chain;
    },
  };

  return db as any;
}

describe("CostService.getUserSpend", () => {
  it("returns the total spend from the DB", async () => {
    const db = mockDb({ spendTotal: 42.5 });
    const service = new CostService(db);
    const spend = await service.getUserSpend("user-1", new Date(2025, 0, 15));
    expect(spend).toBe(42.5);
  });

  it("returns 0 when no rows match", async () => {
    const db = mockDb({ spendTotal: 0 });
    const service = new CostService(db);
    const spend = await service.getUserSpend("user-1", new Date(2025, 0, 15));
    expect(spend).toBe(0);
  });
});

describe("CostService.canSpend (budget enforcement)", () => {
  it("allows spending when no budget is configured", async () => {
    const db = mockDb({ spendTotal: 10, budgetLimit: null });
    const service = new CostService(db);
    const result = await service.canSpend("user-1");

    expect(result.allowed).toBe(true);
    expect(result.remainingUsd).toBe(Infinity);
    expect(result.monthlyLimitUsd).toBeNull();
  });

  it("allows spending when under budget", async () => {
    const db = mockDb({ spendTotal: 30, budgetLimit: 100 });
    const service = new CostService(db);
    const result = await service.canSpend("user-1");

    expect(result.allowed).toBe(true);
    expect(result.remainingUsd).toBe(70);
    expect(result.currentSpendUsd).toBe(30);
    expect(result.monthlyLimitUsd).toBe(100);
  });

  it("denies spending when at budget limit", async () => {
    const db = mockDb({ spendTotal: 100, budgetLimit: 100 });
    const service = new CostService(db);
    const result = await service.canSpend("user-1");

    expect(result.allowed).toBe(false);
    expect(result.remainingUsd).toBe(0);
  });

  it("denies spending when over budget", async () => {
    const db = mockDb({ spendTotal: 150, budgetLimit: 100 });
    const service = new CostService(db);
    const result = await service.canSpend("user-1");

    expect(result.allowed).toBe(false);
    expect(result.remainingUsd).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MODEL_PRICING table completeness
// ---------------------------------------------------------------------------

describe("MODEL_PRICING table", () => {
  it("has pricing for all expected model families", () => {
    const keys = Object.keys(MODEL_PRICING);
    expect(keys.some((k) => k.startsWith("claude-sonnet"))).toBe(true);
    expect(keys.some((k) => k.startsWith("claude-opus"))).toBe(true);
    expect(keys.some((k) => k.startsWith("claude-haiku"))).toBe(true);
    expect(keys.some((k) => k.startsWith("gpt-4o"))).toBe(true);
    expect(keys.some((k) => k.startsWith("o3"))).toBe(true);
  });

  it("all pricing entries have positive values", () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.inputPer1M).toBeGreaterThan(0);
      expect(pricing.outputPer1M).toBeGreaterThan(0);
    }
  });

  it("output pricing is always >= input pricing", () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.outputPer1M).toBeGreaterThanOrEqual(pricing.inputPer1M);
    }
  });
});

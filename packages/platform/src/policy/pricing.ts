// ---------------------------------------------------------------------------
// Model pricing — USD per 1 million tokens
// ---------------------------------------------------------------------------

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15 },
  "claude-sonnet-4-6-20250620": { inputPer1M: 3, outputPer1M: 15 },
  "claude-opus-4-20250514": { inputPer1M: 15, outputPer1M: 75 },
  "claude-opus-4-6-20250620": { inputPer1M: 15, outputPer1M: 75 },
  "claude-opus-4-7-20250715": { inputPer1M: 15, outputPer1M: 75 },
  "claude-haiku-4-5-20250514": { inputPer1M: 0.80, outputPer1M: 4 },
  "gpt-4o": { inputPer1M: 2.50, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "o3": { inputPer1M: 10, outputPer1M: 40 },
  "o3-mini": { inputPer1M: 1.10, outputPer1M: 4.40 },
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = MODEL_PRICING[model] ?? findPricingByPrefix(model);
  if (!pricing) return 0;
  return (
    (inputTokens / 1_000_000) * pricing.inputPer1M +
    (outputTokens / 1_000_000) * pricing.outputPer1M
  );
}

function findPricingByPrefix(model: string): ModelPricing | undefined {
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key.replace(/-\d{8}$/, ""))) return pricing;
  }
  return undefined;
}

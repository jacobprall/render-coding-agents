import { MODEL_DEFS } from "@coding-agents/shared";

/**
 * Validate that a model ID is known and the user has credentials for its provider.
 * OpenAI models are checked against the static catalog.
 * Anthropic models are accepted if the user has an Anthropic key (the dynamic
 * catalog is fetched by the gateway's ModelService, not duplicated here).
 */
export async function validateModel(
  modelId: string,
  keys: { anthropic?: string; openai?: string },
): Promise<{ ok: true } | { ok: false; error: string; available: string[] }> {
  const provider = modelId.split("/")[0];

  if (provider === "openai") {
    if (!keys.openai) {
      return {
        ok: false,
        error: "No OpenAI API key configured. Add one in Settings → API Keys or set OPENAI_API_KEY.",
        available: MODEL_DEFS.filter((m) => m.provider === "openai").map((m) => m.id),
      };
    }
    const known = MODEL_DEFS.some((m) => m.id === modelId);
    if (!known) {
      return {
        ok: false,
        error: `Unknown OpenAI model: ${modelId}`,
        available: MODEL_DEFS.filter((m) => m.provider === "openai").map((m) => m.id),
      };
    }
    return { ok: true };
  }

  if (provider === "anthropic") {
    if (!keys.anthropic) {
      return {
        ok: false,
        error: "No Anthropic API key configured. Add one in Settings → API Keys or set ANTHROPIC_API_KEY.",
        available: [],
      };
    }
    return { ok: true };
  }

  return { ok: false, error: `Unknown provider: ${provider}`, available: [] };
}

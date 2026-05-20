import { MODEL_DEFS } from "@coding-agents/shared";
import type { ResolvedLlmKeys } from "@coding-agents/platform";
import type { LLMProvider } from "./llm";
import { createAnthropicProvider, createOpenAIProvider } from "./llm";

export type ThinkingType = "adaptive" | "enabled";

export interface ModelDef {
  id: string;
  provider: "anthropic" | "openai";
  modelId: string;
  displayName: string;
  supportsThinking?: boolean;
  /** Anthropic models advertise either `adaptive` or `enabled` (or both). */
  thinkingType?: ThinkingType;
}

const MODEL_PREFERENCE = [
  "claude-sonnet-4-6",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-4-5",
  "claude-opus-4",
  "claude-sonnet-4",
  "claude-haiku-4-5",
];

interface AnthropicModelInfo {
  id: string;
  display_name?: string;
  capabilities?: {
    thinking?: {
      supported?: boolean;
      types?: {
        adaptive?: { supported?: boolean };
        enabled?: { supported?: boolean };
      };
    };
  };
}

let _availableModels: ModelDef[] | null = null;
let _defaultModelId: string | null = null;

function toCanonicalId(provider: string, modelId: string): string {
  return `${provider}/${modelId.replace(/-\d{8}$/, "")}`;
}

function modelDefFromCatalog(canonicalId: string): ModelDef | null {
  const entry = MODEL_DEFS.find((m) => m.id === canonicalId);
  if (!entry) return null;
  return {
    id: entry.id,
    provider: entry.provider,
    modelId: entry.nativeId,
    displayName: entry.label,
    supportsThinking: entry.supportsThinking,
  };
}

function parseCanonicalModelId(modelId: string): ModelDef | null {
  const idx = modelId.indexOf("/");
  if (idx <= 0) return null;
  const provider = modelId.slice(0, idx);
  if (provider !== "anthropic" && provider !== "openai") return null;
  const rest = modelId.slice(idx + 1);
  return {
    id: modelId,
    provider,
    modelId: rest,
    displayName: rest,
  };
}

export async function fetchAvailableModels(): Promise<ModelDef[]> {
  const models: ModelDef[] = [];

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const body = (await res.json()) as { data?: AnthropicModelInfo[] };
        for (const m of body.data ?? []) {
          const thinking = m.capabilities?.thinking;
          const supportsAdaptive = thinking?.types?.adaptive?.supported === true;
          const supportsEnabled = thinking?.types?.enabled?.supported === true;
          const thinkingType: ThinkingType | undefined = supportsAdaptive
            ? "adaptive"
            : supportsEnabled
              ? "enabled"
              : undefined;

          models.push({
            id: toCanonicalId("anthropic", m.id),
            provider: "anthropic",
            modelId: m.id,
            displayName: m.display_name ?? m.id,
            supportsThinking: thinkingType !== undefined,
            thinkingType,
          });
        }
      }
    } catch {
      console.warn("[models] Failed to fetch Anthropic models, using fallback");
    }
  }

  if (process.env.OPENAI_API_KEY) {
    for (const m of MODEL_DEFS.filter((d) => d.provider === "openai")) {
      models.push({
        id: m.id,
        provider: "openai",
        modelId: m.nativeId,
        displayName: m.label,
        supportsThinking: m.supportsThinking,
      });
    }
  }

  if (models.length === 0) {
    models.push({
      id: "anthropic/claude-sonnet-4",
      provider: "anthropic",
      modelId: "claude-sonnet-4-20250514",
      displayName: "Claude Sonnet 4",
      supportsThinking: false,
    });
  }

  models.sort((a, b) => {
    const ai = MODEL_PREFERENCE.findIndex((p) => a.modelId.startsWith(p));
    const bi = MODEL_PREFERENCE.findIndex((p) => b.modelId.startsWith(p));
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const seen = new Set<string>();
  const deduped = models.filter((m) => {
    const key = toCanonicalId(m.provider, m.modelId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  _availableModels = deduped;
  _defaultModelId = deduped[0]?.id ?? null;

  console.log(
    `[models] ${deduped.length} models available, default: ${_defaultModelId}`,
  );

  return deduped;
}

export function getAvailableModels(): ModelDef[] {
  if (!_availableModels) {
    throw new Error("Models not initialized — call fetchAvailableModels() at startup");
  }
  return _availableModels;
}

export function getDefaultModelId(): string {
  return _defaultModelId ?? "anthropic/claude-sonnet-4";
}

export function getModelDef(modelId?: string): ModelDef {
  const models = getAvailableModels();
  const id = modelId || getDefaultModelId();
  const found = models.find((m) => m.id === id);
  if (found) return found;
  const fromCat = modelDefFromCatalog(id);
  if (fromCat) return fromCat;
  const parsed = parseCanonicalModelId(id);
  if (parsed) return parsed;
  return models[0]!;
}

export function getModel(
  modelId: string | undefined,
  keys: ResolvedLlmKeys,
): { provider: LLMProvider; modelId: string; providerName: "anthropic" | "openai" } {
  const def = getModelDef(modelId);
  const anthropicKey = keys.anthropic ?? process.env.ANTHROPIC_API_KEY;
  const openaiKey = keys.openai ?? process.env.OPENAI_API_KEY;

  switch (def.provider) {
    case "anthropic": {
      if (!anthropicKey) throw new Error("No Anthropic API key configured for this user or platform");
      return { provider: createAnthropicProvider(anthropicKey), modelId: def.modelId, providerName: "anthropic" };
    }
    case "openai": {
      if (!openaiKey) throw new Error("No OpenAI API key configured for this user or platform");
      return { provider: createOpenAIProvider(openaiKey), modelId: def.modelId, providerName: "openai" };
    }
    default:
      throw new Error(`Unsupported LLM provider: ${def.provider}`);
  }
}

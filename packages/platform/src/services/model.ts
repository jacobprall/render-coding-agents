import { MODEL_DEFS } from "@coding-agents/shared";
import type { PlatformDb } from "../interfaces/database";
import type { AuthContext } from "../interfaces/auth";
import { resolveLlmApiKeys } from "../auth/api-key-resolver";
import type { ResolvedLlmKeys } from "../auth/api-key-resolver";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelSummary {
  id: string;
  provider: string;
  label: string;
  nativeId: string;
  supportsThinking?: boolean;
}

export interface ListModelsResult {
  models: ModelSummary[];
}

// ---------------------------------------------------------------------------
// Anthropic model cache (5 min TTL)
// ---------------------------------------------------------------------------

const anthropicCache = new Map<string, { at: number; models: ModelSummary[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function anthropicCacheKey(apiKey: string | undefined): string {
  if (!apiKey) return "none";
  return `${apiKey.length}:${apiKey.slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// ModelService
// ---------------------------------------------------------------------------

export class ModelService {
  constructor(private db: PlatformDb) {}

  async listModels(auth: AuthContext): Promise<ListModelsResult> {
    const keys = await resolveLlmApiKeys(this.db, auth.userId);
    const models = await fetchModelsForKeys(keys);
    return { models };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function fetchAnthropicModels(apiKey: string | undefined): Promise<ModelSummary[]> {
  const ck = anthropicCacheKey(apiKey);
  const hit = anthropicCache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.models;
  }

  const models: ModelSummary[] = [];

  if (apiKey) {
    try {
      const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const body = (await res.json()) as {
          data?: Array<{
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
          }>;
        };

        const seen = new Set<string>();
        for (const m of body.data ?? []) {
          const canonId = `anthropic/${m.id.replace(/-\d{8}$/, "")}`;
          if (seen.has(canonId)) continue;
          seen.add(canonId);

          const thinking = m.capabilities?.thinking;
          const supportsThinking =
            thinking?.types?.adaptive?.supported === true ||
            thinking?.types?.enabled?.supported === true;

          models.push({
            id: canonId,
            provider: "anthropic",
            label: m.display_name ?? m.id,
            nativeId: m.id,
            supportsThinking,
          });
        }
      } else {
        console.warn(`[models] Anthropic API returned ${res.status}`);
      }
    } catch (err) {
      console.warn("[models] Failed to fetch Anthropic models:", err instanceof Error ? err.message : err);
    }
  }

  if (models.length > 0) {
    anthropicCache.set(ck, { at: Date.now(), models });
  }
  return models;
}

async function fetchModelsForKeys(keys: ResolvedLlmKeys): Promise<ModelSummary[]> {
  const anthropic = await fetchAnthropicModels(keys.anthropic);

  const openai = keys.openai
    ? MODEL_DEFS.filter((m) => m.provider === "openai").map((m) => ({
        id: m.id,
        provider: "openai",
        label: m.label,
        nativeId: m.nativeId,
        supportsThinking: m.supportsThinking,
      }))
    : [];

  const merged = [...anthropic, ...openai];
  const seen = new Set<string>();
  return merged.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

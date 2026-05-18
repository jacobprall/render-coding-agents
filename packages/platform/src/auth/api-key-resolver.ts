import { and, eq, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "@openforge/db/schema";
import { decryptLlmApiKey } from "./encryption";

export type ResolvedLlmKeys = {
  anthropic?: string;
  openai?: string;
};

function tryDecryptRow(
  row: typeof schema.llmApiKeys.$inferSelect | undefined,
): string | undefined {
  if (!row?.isValid) return undefined;
  try {
    return decryptLlmApiKey(row.encryptedKey);
  } catch {
    return undefined;
  }
}

/**
 * Resolves LLM credentials for a user: user-scoped DB row overrides platform row; both override env.
 */
export async function resolveLlmApiKeys(
  db: PostgresJsDatabase<typeof schema>,
  userId: string,
): Promise<ResolvedLlmKeys> {
  const allKeys = await db
    .select()
    .from(schema.llmApiKeys)
    .where(
      and(
        eq(schema.llmApiKeys.isValid, true),
        or(
          eq(schema.llmApiKeys.scope, "platform"),
          and(eq(schema.llmApiKeys.scope, "user"), eq(schema.llmApiKeys.userId, userId)),
        ),
      ),
    );

  const tryDecryptForProvider = (provider: "anthropic" | "openai"): string | undefined => {
    const userKey = allKeys.find((k) => k.provider === provider && k.scope === "user");
    const platformKey = allKeys.find((k) => k.provider === provider && k.scope === "platform");
    return tryDecryptRow(userKey) ?? tryDecryptRow(platformKey);
  };

  const anthropic =
    tryDecryptForProvider("anthropic") ?? process.env.ANTHROPIC_API_KEY;

  const openai = tryDecryptForProvider("openai") ?? process.env.OPENAI_API_KEY;

  const out: ResolvedLlmKeys = {};
  if (anthropic) out.anthropic = anthropic;
  if (openai) out.openai = openai;
  return out;
}

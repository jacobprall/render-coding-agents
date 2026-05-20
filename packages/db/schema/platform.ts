import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { agentRuns, sessions } from "./session";

// ---------------------------------------------------------------------------
// LLM API keys (encrypted at rest — plaintext only in memory when calling providers)
// ---------------------------------------------------------------------------

export const llmApiKeys = pgTable(
  "llm_api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    provider: text("provider", {
      enum: ["anthropic", "openai"],
    }).notNull(),
    scope: text("scope", {
      enum: ["platform", "user"],
    }).notNull(),
    /** Required when scope is `user`; must be null for platform keys. */
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull().default("API key"),
    encryptedKey: text("encrypted_key").notNull(),
    /** Last few characters of the key for display (never the full secret). */
    keyHint: text("key_hint").notNull(),
    isValid: boolean("is_valid").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("llm_api_keys_user_id_idx").on(table.userId),
    index("llm_api_keys_scope_idx").on(table.scope),
    uniqueIndex("llm_api_keys_platform_provider_uidx")
      .on(table.provider)
      .where(sql`${table.scope} = 'platform'`),
    uniqueIndex("llm_api_keys_user_provider_uidx")
      .on(table.provider, table.userId)
      .where(sql`${table.scope} = 'user' and ${table.userId} is not null`),
  ],
);

// ---------------------------------------------------------------------------
// User preferences
// ---------------------------------------------------------------------------

export interface UserPreferencesData {
  defaultModelId?: string | null;
  defaultSubagentModelId?: string | null;
  defaultDiffMode?: "unified" | "split";
  defaultWorkflowMode?: "full" | "standard" | "fast" | "yolo" | "autonomous";
  autoCommitPush?: boolean;
  autoCreatePr?: boolean;
  accentColor?: string | null;
  secondaryColor?: string | null;
  tertiaryColor?: string | null;
  theme?: "dark" | "light" | null;
}

export const userPreferences = pgTable("user_preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  data: jsonb("data").$type<UserPreferencesData>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    agentType: text("agent_type", { enum: ["main", "subagent"] })
      .notNull()
      .default("main"),
    provider: text("provider"),
    modelId: text("model_id"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    toolCallCount: integer("tool_call_count").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("usage_events_user_id_idx").on(table.userId),
    index("usage_events_user_created_idx").on(table.userId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Gateway API keys (hashed for auth)
// ---------------------------------------------------------------------------

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id").notNull(),
    label: text("label").notNull(),
    hashedKey: text("hashed_key").notNull().unique(),
    prefix: text("prefix").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("api_keys_user_id_idx").on(table.userId),
    index("api_keys_hashed_key_idx").on(table.hashedKey),
  ],
);

// ---------------------------------------------------------------------------
// Skill cache (optional mirror of git-backed skill files)
// ---------------------------------------------------------------------------

export const skillCache = pgTable(
  "skill_cache",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    repoPath: text("repo_path"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    source: text("source", {
      enum: ["builtin", "user", "repo"],
    }).notNull(),
    content: text("content").notNull(),
    filePath: text("file_path").notNull(),
    contentHash: text("content_hash").notNull(),
    syncedAt: timestamp("synced_at").defaultNow().notNull(),
  },
  (table) => [
    index("skill_cache_user_slug_idx").on(table.userId, table.slug),
    index("skill_cache_repo_slug_idx").on(table.repoPath, table.slug),
  ],
);

// ---------------------------------------------------------------------------
// LLM calls — records every LLM API call for cost tracking & observability
// ---------------------------------------------------------------------------

export const llmCalls = pgTable(
  "llm_calls",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => agentRuns.id),
    sessionId: text("session_id").references(() => sessions.id),
    userId: text("user_id").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6 }).notNull(),
    latencyMs: integer("latency_ms").notNull(),
    stopReason: text("stop_reason"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("llm_calls_user_id_idx").on(table.userId),
    index("llm_calls_run_id_idx").on(table.runId),
    index("llm_calls_session_id_idx").on(table.sessionId),
    index("llm_calls_user_created_idx").on(table.userId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Budgets — monthly spend limits per user or org
// ---------------------------------------------------------------------------

export const budgets = pgTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    orgId: text("org_id"),
    monthlyLimitUsd: numeric("monthly_limit_usd", { precision: 10, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("budgets_user_id_idx").on(table.userId),
    index("budgets_org_id_idx").on(table.orgId),
  ],
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserPreferences = typeof userPreferences.$inferSelect;
export type NewUserPreferences = typeof userPreferences.$inferInsert;
export type LlmApiKeyRow = typeof llmApiKeys.$inferSelect;
export type NewLlmApiKeyRow = typeof llmApiKeys.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type SkillCacheRow = typeof skillCache.$inferSelect;
export type NewSkillCacheRow = typeof skillCache.$inferInsert;
export type LlmCall = typeof llmCalls.$inferSelect;
export type NewLlmCall = typeof llmCalls.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;

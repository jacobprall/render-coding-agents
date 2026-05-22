import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

type SkillRef = { source: "builtin" | "user" | "repo"; slug: string };

type SecretsConfig = {
  env: Record<string, string>;
  runtime: Record<string, string>;
  build: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Orgs — single row per deployment (the team using this Coding Agents instance)
// ---------------------------------------------------------------------------

export const orgs = pgTable("orgs", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Projects — the primary organizational unit
// ---------------------------------------------------------------------------

export const projects = pgTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: text("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    /** Persistent settings (auto-merge, default model, verify checks, etc.) */
    config: jsonb("config").$type<Record<string, unknown>>(),
    /** Persistent natural-language rules for the agent, inherited by every session */
    instructions: text("instructions"),
    isScratch: boolean("is_scratch").notNull().default(false),
    environmentConfig: jsonb("environment_config")
      .$type<Record<string, string>>()
      .default({}),
    secretsConfig: jsonb("secrets_config")
      .$type<SecretsConfig>()
      .default({ env: {}, runtime: {}, build: {} }),
    computeDefaults: jsonb("compute_defaults")
      .$type<Record<string, unknown>>()
      .default({}),
    defaultSkills: jsonb("default_skills").$type<SkillRef[]>().default([]),
    repoMirrorStatus: jsonb("repo_mirror_status")
      .$type<Record<string, unknown>>()
      .default({}),
    lastMirrorSyncedAt: timestamp("last_mirror_synced_at"),
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("projects_org_slug_idx").on(table.orgId, table.slug),
    index("projects_org_id_idx").on(table.orgId),
    index("projects_created_by_idx").on(table.createdBy),
  ],
);

// ---------------------------------------------------------------------------
// Project repos — links projects to repositories (many-to-many)
// ---------------------------------------------------------------------------

export const projectRepos = pgTable(
  "project_repos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repoPath: text("repo_path").notNull(),
    forgeType: text("forge_type", {
      enum: ["github", "gitlab"],
    }),
    defaultBranch: text("default_branch").default("main"),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("project_repos_project_repo_idx").on(
      table.projectId,
      table.repoPath,
    ),
    index("project_repos_project_id_idx").on(table.projectId),
  ],
);

// ---------------------------------------------------------------------------
// Mirror sync log — audit trail for repo mirror operations
// ---------------------------------------------------------------------------

export const mirrorSyncLog = pgTable(
  "mirror_sync_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    repoPath: text("repo_path").notNull(),
    trigger: text("trigger", {
      enum: ["webhook", "cron", "session_init", "manual"],
    }).notNull(),
    status: text("status", { enum: ["success", "failed"] }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("mirror_sync_log_project_idx").on(table.projectId),
    index("mirror_sync_log_created_idx").on(table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Org = typeof orgs.$inferSelect;
export type NewOrg = typeof orgs.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ProjectRepo = typeof projectRepos.$inferSelect;
export type NewProjectRepo = typeof projectRepos.$inferInsert;
export type MirrorSyncLog = typeof mirrorSyncLog.$inferSelect;
export type NewMirrorSyncLog = typeof mirrorSyncLog.$inferInsert;

import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Sessions (agent workspaces tied to forge repos)
// ---------------------------------------------------------------------------

export type SessionPhase =
  | "understand"
  | "spec"
  | "execute"
  | "verify"
  | "deliver"
  | "complete"
  | "failed";

export type WorkflowMode = "full" | "standard" | "fast" | "yolo" | "autonomous";

export type ForgeType = "forgejo" | "github" | "gitlab";

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** Forge login — for resolving user-scoped skills when OAuth token is unavailable (webhooks). */
    forgeUsername: text("forge_username"),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["running", "completed", "failed", "archived"],
    })
      .notNull()
      .default("running"),

    // Project binding
    projectId: text("project_id"),

    // Repo binding (forge-agnostic) — nullable for scratch/workbench sessions
    repoPath: text("repo_path"),
    forgeType: text("forge_type", {
      enum: ["forgejo", "github", "gitlab"],
    }),
    branch: text("branch"),
    baseBranch: text("base_branch").default("main"),

    // PR state
    prNumber: integer("pr_number"),
    prStatus: text("pr_status", {
      enum: ["open", "merged", "closed"],
    }),

    // Upstream sync (optional — only if linked to external repo)
    upstreamProvider: text("upstream_provider"),
    upstreamRepoUrl: text("upstream_repo_url"),
    upstreamPrUrl: text("upstream_pr_url"),

    // Workflow (legacy columns — prefer activeSkills for new sessions)
    phase: text("phase", {
      enum: ["understand", "spec", "execute", "verify", "deliver", "complete", "failed"],
    }).notNull().default("execute"),
    workflowMode: text("workflow_mode", {
      enum: ["full", "standard", "fast", "yolo", "autonomous"],
    }).notNull().default("standard"),

    /** Json array of { source: "builtin"|"user"|"repo", slug: string } */
    activeSkills: jsonb("active_skills").$type<
      Array<{ source: "builtin" | "user" | "repo"; slug: string }>
    >(),

    // Project context
    projectConfig: jsonb("project_config"),
    projectContext: text("project_context"),

    // Git stats
    linesAdded: integer("lines_added").default(0),
    linesRemoved: integer("lines_removed").default(0),

    // CI fix tracking
    ciFixAttempts: integer("ci_fix_attempts").notNull().default(0),
    maxCiFixAttempts: integer("max_ci_fix_attempts").notNull().default(3),

    // Timestamps
    lastActivityAt: timestamp("last_activity_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_project_id_idx").on(table.projectId),
    index("sessions_repo_path_idx").on(table.repoPath),
    index("sessions_repo_branch_idx").on(table.repoPath, table.branch),
  ],
);

// ---------------------------------------------------------------------------
// Chats & messages
// ---------------------------------------------------------------------------

export const chats = pgTable(
  "chats",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    modelId: text("model_id").default("anthropic/claude-sonnet-4-5"),
    activeRunId: text("active_run_id"),
    lastAssistantMessageAt: timestamp("last_assistant_message_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("chats_session_id_idx").on(table.sessionId)],
);

export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  role: text("role", {
    enum: ["user", "assistant"],
  }).notNull(),
  parts: jsonb("parts").notNull(),
  modelMessages: jsonb("model_messages"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Agent runs
// ---------------------------------------------------------------------------

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    modelId: text("model_id"),
    phase: text("phase", {
      enum: ["understand", "spec", "execute", "verify", "deliver", "complete", "failed"],
    }),
    status: text("status", {
      enum: ["queued", "running", "paused", "completed", "aborted", "failed", "error"],
    }).notNull().default("queued"),
    trigger: text("trigger", {
      enum: ["user_message", "ci_failure", "review_comment", "pr_opened", "pr_merged", "workflow_run", "deploy_failure"],
    }),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    totalDurationMs: integer("total_duration_ms"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: text("cost_usd"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("agent_runs_chat_id_idx").on(table.chatId),
    index("agent_runs_session_id_idx").on(table.sessionId),
    index("agent_runs_user_id_idx").on(table.userId),
    index("agent_runs_session_status_idx").on(table.sessionId, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

export const specs = pgTable("specs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  status: text("status", {
    enum: ["draft", "approved", "rejected", "superseded"],
  }).notNull().default("draft"),
  goal: text("goal").notNull(),
  approach: text("approach").notNull(),
  filesToModify: jsonb("files_to_modify").$type<string[]>().notNull().default([]),
  filesToCreate: jsonb("files_to_create").$type<string[]>().notNull().default([]),
  risks: jsonb("risks").$type<string[]>().notNull().default([]),
  outOfScope: jsonb("out_of_scope").$type<string[]>().notNull().default([]),
  verificationPlan: text("verification_plan").notNull().default(""),
  estimatedComplexity: text("estimated_complexity", {
    enum: ["trivial", "small", "medium", "large"],
  }).notNull().default("small"),
  rejectionNote: text("rejection_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  approvedAt: timestamp("approved_at"),
});

// ---------------------------------------------------------------------------
// Verification results
// ---------------------------------------------------------------------------

export const verificationResults = pgTable("verification_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  checkName: text("check_name").notNull(),
  passed: boolean("passed").notNull().default(false),
  status: text("status", {
    enum: ["pass", "fail", "error", "timeout"],
  }).notNull(),
  exitCode: integer("exit_code"),
  output: text("output").notNull().default(""),
  stdout: text("stdout").notNull().default(""),
  stderr: text("stderr").notNull().default(""),
  durationMs: integer("duration_ms").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Chat = typeof chats.$inferSelect;
export type NewChat = typeof chats.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type Spec = typeof specs.$inferSelect;
export type NewSpec = typeof specs.$inferInsert;
export type VerificationResult = typeof verificationResults.$inferSelect;
export type NewVerificationResult = typeof verificationResults.$inferInsert;

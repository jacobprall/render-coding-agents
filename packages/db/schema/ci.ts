import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { sessions } from "./session";

// ---------------------------------------------------------------------------
// CI events (from forge webhooks)
// ---------------------------------------------------------------------------

export const ciEvents = pgTable(
  "ci_events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "ci_running",
        "ci_failure",
        "ci_success",
        "review_comment",
        "pr_merged",
        "pr_closed",
      ],
    }).notNull(),
    workflowName: text("workflow_name"),
    runId: text("run_id"),
    status: text("status", {
      enum: ["pending", "running", "success", "failure", "error"],
    }),
    logsUrl: text("logs_url"),
    payload: jsonb("payload").notNull(),
    processed: boolean("processed").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("ci_events_session_id_idx").on(table.sessionId),
    index("ci_events_run_id_idx").on(table.runId),
  ],
);

// ---------------------------------------------------------------------------
// PR events (lifecycle tracking — feeds global PR view & future inbox)
// ---------------------------------------------------------------------------

export type PrEventAction =
  | "opened"
  | "closed"
  | "merged"
  | "ci_passed"
  | "ci_failed"
  | "review_requested"
  | "review_submitted"
  | "commented";

export const prEvents = pgTable(
  "pr_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    repoPath: text("repo_path").notNull(),
    prNumber: integer("pr_number").notNull(),
    action: text("action", {
      enum: [
        "opened",
        "closed",
        "merged",
        "ci_passed",
        "ci_failed",
        "review_requested",
        "review_submitted",
        "commented",
      ],
    }).notNull(),
    title: text("title"),
    /** Whether this event still requires user attention (for future inbox) */
    actionNeeded: boolean("action_needed").notNull().default(false),
    /** Whether user has seen/dismissed this event (for future inbox) */
    read: boolean("read").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("pr_events_user_id_idx").on(table.userId),
    index("pr_events_session_id_idx").on(table.sessionId),
    index("pr_events_action_needed_idx").on(table.userId, table.actionNeeded),
  ],
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CiEvent = typeof ciEvents.$inferSelect;
export type NewCiEvent = typeof ciEvents.$inferInsert;
export type PrEvent = typeof prEvents.$inferSelect;
export type NewPrEvent = typeof prEvents.$inferInsert;

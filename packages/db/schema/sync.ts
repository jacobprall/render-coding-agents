import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sessions } from "./session";

// ---------------------------------------------------------------------------
// Sync connections (external forge accounts)
// ---------------------------------------------------------------------------

export const syncConnections = pgTable(
  "sync_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    provider: text("provider", {
      enum: ["github", "gitlab", "bitbucket"],
    }).notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at"),
    remoteUsername: text("remote_username"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("sync_connections_user_provider_idx").on(table.userId, table.provider),
  ],
);

// ---------------------------------------------------------------------------
// Mirrors (active repo sync relationships)
// ---------------------------------------------------------------------------

export const mirrors = pgTable(
  "mirrors",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
    syncConnectionId: text("sync_connection_id")
      .notNull()
      .references(() => syncConnections.id, { onDelete: "cascade" }),
    localRepoPath: text("local_repo_path").notNull(),
    remoteRepoUrl: text("remote_repo_url").notNull(),
    direction: text("direction", {
      enum: ["pull", "push", "bidirectional"],
    }).notNull(),
    lastSyncAt: timestamp("last_sync_at"),
    status: text("status", {
      enum: ["active", "paused", "error"],
    }).notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("mirrors_remote_repo_url_idx").on(table.remoteRepoUrl)],
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyncConnection = typeof syncConnections.$inferSelect;
export type NewSyncConnection = typeof syncConnections.$inferInsert;
export type Mirror = typeof mirrors.$inferSelect;
export type NewMirror = typeof mirrors.$inferInsert;

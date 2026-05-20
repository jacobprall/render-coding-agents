import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ---------------------------------------------------------------------------
// Auth: Users (NextAuth identity — one per human)
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date" }),
  image: text("image"),

  externalProviderId: integer("forgejo_user_id").unique(),
  externalUsername: text("forgejo_username"),

  /** Set when the user completes invite password setup; bcrypt hash. */
  passwordHash: text("password_hash"),

  /** FK to the org this user belongs to (single org per deployment). */
  orgId: text("org_id"),

  /** Platform admin — can manage platform-scoped LLM API keys and sees global key metadata. */
  isAdmin: boolean("is_admin").notNull().default(false),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Auth: Accounts (OAuth provider links — NextAuth standard)
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
  ],
);

// ---------------------------------------------------------------------------
// Auth: Verification Tokens (for future magic-link / email flows)
// ---------------------------------------------------------------------------

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token] }),
  ],
);

// ---------------------------------------------------------------------------
// Auth: Invites (signed invite URLs for onboarding test users)
// ---------------------------------------------------------------------------

export const invites = pgTable(
  "invites",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    email: text("email"),
    externalUsername: text("forgejo_username"),
    /** Pre-provisioned app user row (no password until invite is accepted). */
    invitedUserId: text("invited_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    redeemedAt: timestamp("redeemed_at"),
    redeemedBy: text("redeemed_by").references(() => users.id),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("invites_token_idx").on(table.token)],
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;

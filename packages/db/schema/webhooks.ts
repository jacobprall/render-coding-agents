/**
 * webhook_deliveries — idempotency table for inbound webhook events.
 *
 * Every processed delivery ID is recorded here so that replayed or retried
 * webhook events are detected and safely ignored instead of triggering
 * duplicate agent runs.
 */

import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    /** The delivery ID supplied by the provider (e.g. x-github-delivery, x-forgejo-delivery). */
    id: text("id").primaryKey(),
    /** Source provider: github, gitlab, forgejo, render, ci, etc. */
    source: text("source").notNull(),
    /** Canonical event kind (review_comment, pr_opened, ci_failure, …). */
    kind: text("kind").notNull(),
    /** Set when the delivery resulted in a session or run being created. */
    sessionId: text("session_id"),
    /** Set when the delivery resulted in an agent run being queued. */
    runId: text("run_id"),
    /** True once business-logic processing is complete. */
    processed: boolean("processed").notNull().default(false),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("webhook_deliveries_source_idx").on(table.source, table.receivedAt),
  ],
);

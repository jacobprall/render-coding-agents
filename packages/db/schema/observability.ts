import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agentRuns, sessions } from "./session";

export const OBSERVABILITY_EVENT_TYPES = [
  "llm_request",
  "tool_call",
  "sandbox_exec",
  "error",
  "system",
] as const;

export const OBSERVABILITY_EVENT_STATUSES = [
  "running",
  "success",
  "error",
  "timeout",
  "interrupted",
] as const;

export type ObservabilityEventType = (typeof OBSERVABILITY_EVENT_TYPES)[number];
export type ObservabilityEventStatus = (typeof OBSERVABILITY_EVENT_STATUSES)[number];

/**
 * Normalized identity for a logical event stream inside a session.
 * Keeps high-cardinality data out of row-level events.
 */
export const eventSeries = pgTable(
  "event_series",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    eventType: text("event_type", {
      enum: OBSERVABILITY_EVENT_TYPES,
    }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("event_series_session_id_idx").on(table.sessionId),
    uniqueIndex("event_series_session_type_uidx").on(table.sessionId, table.eventType),
  ],
);

/**
 * Durable event log for agent observability.
 * NOTE: table partitioning is managed in SQL migrations (not Drizzle schema DSL).
 */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    seriesId: integer("series_id")
      .notNull()
      .references(() => eventSeries.id, { onDelete: "cascade" }),
    parentEventId: text("parent_event_id"),
    eventType: text("event_type", {
      enum: OBSERVABILITY_EVENT_TYPES,
    }).notNull(),
    status: text("status", {
      enum: OBSERVABILITY_EVENT_STATUSES,
    }).notNull().default("running"),
    startedAt: timestamp("started_at").notNull(),
    endedAt: timestamp("ended_at"),
    durationMs: integer("duration_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("agent_events_session_created_idx").on(table.sessionId, table.createdAt),
    index("agent_events_series_created_idx").on(table.seriesId, table.createdAt),
    index("agent_events_run_created_idx").on(table.runId, table.createdAt),
    index("agent_events_status_idx").on(table.status),
    index("agent_events_parent_idx").on(table.parentEventId),
  ],
);

export type EventSeries = typeof eventSeries.$inferSelect;
export type NewEventSeries = typeof eventSeries.$inferInsert;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type NewAgentEvent = typeof agentEvents.$inferInsert;

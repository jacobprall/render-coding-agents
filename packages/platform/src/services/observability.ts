import { and, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import {
  agentEvents,
  eventSeries,
  sessions,
  type NewAgentEvent,
  type ObservabilityEventStatus,
  type ObservabilityEventType,
} from "@coding-agents/db";
import { SessionNotFoundError } from "@coding-agents/shared";
import type { AuthContext } from "../interfaces/auth";
import type { PlatformDb } from "../interfaces/database";

const DEFAULT_RETENTION_DAYS = 30;
const MAX_PAGE_SIZE = 200;

export type NewAgentEventInput = Omit<NewAgentEvent, "seriesId"> & { seriesId?: number };

export interface EventQueryOptions {
  limit?: number;
  cursor?: string;
  type?: ObservabilityEventType | ObservabilityEventType[];
  status?: ObservabilityEventStatus | ObservabilityEventStatus[];
  after?: Date;
  before?: Date;
}

export interface UsageAggregateOptions {
  from: Date;
  to: Date;
  groupBy?: "model" | "session";
}

export interface UsageAggregateResult {
  totals: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
  breakdown: Array<{
    key: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    llmRequestCount: number;
  }>;
}

type SeriesCacheKey = `${string}:${ObservabilityEventType}`;

export class ObservabilityService {
  private readonly seriesCache = new Map<SeriesCacheKey, number>();

  constructor(private db: PlatformDb) {}

  async recordEvent(event: NewAgentEventInput): Promise<void> {
    await this.recordBatch([event]);
  }

  async recordBatch(events: NewAgentEventInput[]): Promise<void> {
    if (events.length === 0) return;

    const rows: NewAgentEvent[] = [];
    for (const event of events) {
      const seriesId = event.seriesId ?? (await this.resolveSeriesId(event.sessionId, event.eventType));
      rows.push({
        ...event,
        seriesId,
      });
    }

    await this.db.insert(agentEvents).values(rows);
  }

  async queryBySession(
    auth: AuthContext,
    sessionId: string,
    opts: EventQueryOptions = {},
  ) {
    await this.assertSessionAccess(auth, sessionId);

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), MAX_PAGE_SIZE);
    const predicates = [
      eq(agentEvents.sessionId, sessionId),
      opts.after ? gte(agentEvents.createdAt, opts.after) : undefined,
      opts.before ? lte(agentEvents.createdAt, opts.before) : undefined,
      opts.cursor ? sql`${agentEvents.id} < ${opts.cursor}` : undefined,
      this.buildTypePredicate(opts.type),
      this.buildStatusPredicate(opts.status),
    ].filter(Boolean);

    const rows = await this.db
      .select()
      .from(agentEvents)
      .where(and(...predicates))
      .orderBy(desc(agentEvents.createdAt), desc(agentEvents.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      items,
      nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    };
  }

  async aggregateUsage(
    auth: AuthContext,
    opts: UsageAggregateOptions,
  ): Promise<UsageAggregateResult> {
    const from = opts.from;
    const to = opts.to;

    const scopePredicate = auth.isAdmin
      ? undefined
      : sql`exists (
        select 1
        from ${sessions}
        where ${sessions.id} = ${agentEvents.sessionId}
          and ${sessions.userId} = ${auth.userId}
      )`;

    const modelExpr = sql<string>`coalesce(${agentEvents.metadata}->>'model', 'unknown')`;
    const sessionExpr = sql<string>`coalesce(${agentEvents.sessionId}, 'unknown')`;
    const groupExpr = opts.groupBy === "session" ? sessionExpr : modelExpr;

    const rows = await this.db
      .select({
        key: groupExpr,
        inputTokens: sql<number>`coalesce(sum(((${agentEvents.metadata}->'tokens'->>'input')::int)), 0)`,
        outputTokens: sql<number>`coalesce(sum(((${agentEvents.metadata}->'tokens'->>'output')::int)), 0)`,
        estimatedCost: sql<number>`coalesce(sum(((${agentEvents.metadata}->>'estimatedCostUsd')::numeric)), 0)`,
        llmRequestCount: sql<number>`count(*)`,
      })
      .from(agentEvents)
      .where(
        and(
          eq(agentEvents.eventType, "llm_request"),
          gte(agentEvents.createdAt, from),
          lte(agentEvents.createdAt, to),
          scopePredicate,
        ),
      )
      .groupBy(groupExpr)
      .orderBy(desc(sql`count(*)`));

    const breakdown = rows.map((row) => ({
      key: row.key,
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
      estimatedCost: Number(row.estimatedCost),
      llmRequestCount: Number(row.llmRequestCount),
    }));

    return {
      totals: {
        inputTokens: breakdown.reduce((sum, row) => sum + row.inputTokens, 0),
        outputTokens: breakdown.reduce((sum, row) => sum + row.outputTokens, 0),
        estimatedCost: breakdown.reduce((sum, row) => sum + row.estimatedCost, 0),
      },
      breakdown,
    };
  }

  async runRetention(retentionDays = DEFAULT_RETENTION_DAYS): Promise<{ deleted: number }> {
    await this.dropOldMonthlyPartitions(retentionDays);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const deletedRows = await this.db
      .delete(agentEvents)
      .where(lte(agentEvents.createdAt, cutoff))
      .returning({ id: agentEvents.id });

    return { deleted: deletedRows.length };
  }

  private async resolveSeriesId(sessionId: string, eventType: ObservabilityEventType): Promise<number> {
    const key: SeriesCacheKey = `${sessionId}:${eventType}`;
    const cached = this.seriesCache.get(key);
    if (cached) return cached;

    const existing = await this.db
      .select({ id: eventSeries.id })
      .from(eventSeries)
      .where(and(eq(eventSeries.sessionId, sessionId), eq(eventSeries.eventType, eventType)))
      .limit(1);
    if (existing[0]) {
      this.seriesCache.set(key, existing[0].id);
      return existing[0].id;
    }

    const inserted = await this.db
      .insert(eventSeries)
      .values({
        sessionId,
        eventType,
      })
      .onConflictDoUpdate({
        target: [eventSeries.sessionId, eventSeries.eventType],
        set: { eventType },
      })
      .returning({ id: eventSeries.id });

    const id = inserted[0]!.id;
    this.seriesCache.set(key, id);
    return id;
  }

  private async assertSessionAccess(auth: AuthContext, sessionId: string): Promise<void> {
    const whereClause = auth.isAdmin
      ? eq(sessions.id, sessionId)
      : and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId));

    const row = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(whereClause)
      .limit(1);

    if (!row[0]) throw new SessionNotFoundError();
  }

  private buildTypePredicate(type?: EventQueryOptions["type"]) {
    if (!type) return undefined;
    if (Array.isArray(type)) return inArray(agentEvents.eventType, type);
    return eq(agentEvents.eventType, type);
  }

  private buildStatusPredicate(status?: EventQueryOptions["status"]) {
    if (!status) return undefined;
    if (Array.isArray(status)) return inArray(agentEvents.status, status);
    return eq(agentEvents.status, status);
  }

  private async dropOldMonthlyPartitions(retentionDays: number): Promise<void> {
    const monthsToKeep = Math.max(1, Math.ceil(retentionDays / 30));
    const now = new Date();
    const threshold = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsToKeep, 1));
    const thresholdName = this.partitionNameForMonth(threshold);

    try {
      const partitions = await this.db.execute(
        sql`
          select inhrelid::regclass::text as name
          from pg_inherits
          where inhparent = 'agent_events'::regclass
        `,
      );

      for (const row of partitions as unknown as Array<{ name: string }>) {
        const name = row.name?.replace(/^public\./, "");
        if (!name?.startsWith("agent_events_")) continue;
        if (name < thresholdName) {
          await this.db.execute(sql.raw(`drop table if exists "${name}"`));
        }
      }
    } catch {
      // Partition management is best-effort; retention deletion still applies.
    }
  }

  private partitionNameForMonth(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    return `agent_events_${year}_${month}`;
  }
}

import { and, desc, eq } from "drizzle-orm";
import { agentRuns, ciEvents, sessions } from "@openforge/db";
import type { PlatformDb } from "../interfaces/database";
import type { AuthContext } from "../interfaces/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationType =
  | "agent_needs_input"
  | "ci_failed"
  | "pr_merged"
  | "review_requested"
  | "escalation";

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: Date;
}

export interface ListNotificationsParams {
  limit: number;
  offset: number;
}

export interface ListNotificationsResult {
  notifications: Notification[];
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// NotificationService
// ---------------------------------------------------------------------------

export class NotificationService {
  constructor(private db: PlatformDb) {}

  // -------------------------------------------------------------------------
  // list — GET /api/notifications
  // -------------------------------------------------------------------------

  async list(
    auth: AuthContext,
    params: ListNotificationsParams,
  ): Promise<ListNotificationsResult> {
    const { limit, offset } = params;
    const userId = auth.userId;
    const fetchLimit = offset + limit + 1;

    const [failedCi, errorRuns] = await Promise.all([
      this.db
        .select()
        .from(ciEvents)
        .innerJoin(sessions, eq(ciEvents.sessionId, sessions.id))
        .where(
          and(
            eq(sessions.userId, userId),
            eq(ciEvents.type, "ci_failure"),
            eq(ciEvents.processed, false),
          ),
        )
        .orderBy(desc(ciEvents.createdAt))
        .limit(fetchLimit),
      this.db
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.userId, userId), eq(agentRuns.status, "error")))
        .orderBy(desc(agentRuns.createdAt))
        .limit(fetchLimit),
    ]);

    const notifications: Notification[] = [];

    for (const row of failedCi) {
      notifications.push({
        id: `ci-${row.ci_events.id}`,
        userId,
        type: "ci_failed",
        title: "CI Failed",
        body: `Workflow "${row.ci_events.workflowName || "build"}" failed`,
        link: `/sessions/${row.ci_events.sessionId}`,
        read: false,
        createdAt: row.ci_events.createdAt,
      });
    }

    for (const run of errorRuns) {
      notifications.push({
        id: `run-${run.id}`,
        userId,
        type: "agent_needs_input",
        title: "Agent Error",
        body: `Agent run failed (${run.trigger || "manual"})`,
        link: `/sessions/${run.sessionId}`,
        read: false,
        createdAt: run.createdAt,
      });
    }

    notifications.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const window = notifications.slice(offset, offset + limit + 1);
    const hasMore = window.length > limit;
    const pageData = hasMore ? window.slice(0, limit) : window;

    return { notifications: pageData, hasMore };
  }
}

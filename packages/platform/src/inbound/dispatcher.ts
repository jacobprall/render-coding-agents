/**
 * Dispatcher — executes RouteActions by delegating to existing platform services.
 *
 * This keeps the router pure (returns actions, no side effects) while the
 * dispatcher owns the bridge to the actual DB + queue operations.
 */

import { desc, eq, inArray, and } from "drizzle-orm";
import { agentRuns, sessions } from "@coding-agents/db";
import { logger } from "@coding-agents/shared";
import type { PlatformDb } from "../interfaces/database";
import type { QueueAdapter } from "../interfaces/queue";
import type { CIService } from "../services/ci";
import type {
  RouteAction,
  TriggerSessionAction,
  CreateDiagnosticSessionAction,
  CoalesceAction,
  SessionMatcher,
} from "./types";

export interface DispatcherDeps {
  db: PlatformDb;
  queue: QueueAdapter;
  ciService: CIService;
  /** Optional: session factory used for deploy failure diagnostics */
  createFromDeployFailure?: (params: {
    serviceId: string;
    serviceName: string;
    deployId: string;
    commitId?: string;
    commitMessage?: string;
  }) => Promise<{ sessionId: string; runId: string } | null>;
}

export class InboundDispatcher {
  constructor(private deps: DispatcherDeps) {}

  async dispatch(action: RouteAction): Promise<void> {
    switch (action.type) {
      case "trigger_session":
        await this.dispatchTrigger(action);
        break;
      case "create_diagnostic_session":
        await this.dispatchDiagnosticSession(action);
        break;
      case "coalesce":
        await this.dispatchCoalesce(action);
        break;
      case "ignore":
        logger.info("inbound.dispatch.ignored", { reason: action.reason });
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Trigger an existing session
  // -------------------------------------------------------------------------

  private async dispatchTrigger(action: TriggerSessionAction): Promise<void> {
    const sessionRows = await this.matchSessions(action.sessionMatcher);
    if (sessionRows.length === 0) {
      logger.info("inbound.dispatch.trigger: no matching sessions", {
        matcher: action.sessionMatcher,
      });
      return;
    }

    for (const session of sessionRows) {
      if (session.status !== "running") continue;

      await this.deps.ciService
        .enqueueSessionTriggerJob({
          sessionRow: session,
          userId: session.userId,
          trigger: action.trigger,
          fixContext: action.fixContext,
        })
        .catch((err) =>
          logger.errorWithCause(err, "inbound.dispatch.trigger: enqueue failed", {
            sessionId: session.id,
            trigger: action.trigger,
          }),
        );
    }
  }

  // -------------------------------------------------------------------------
  // Create a diagnostic session for deploy failures
  // -------------------------------------------------------------------------

  private async dispatchDiagnosticSession(
    action: CreateDiagnosticSessionAction,
  ): Promise<void> {
    if (!this.deps.createFromDeployFailure) {
      logger.warn("inbound.dispatch.diagnostic: createFromDeployFailure not wired", {});
      return;
    }

    const result = await this.deps.createFromDeployFailure({
      serviceId: action.serviceId,
      serviceName: action.serviceName,
      deployId: action.deployId,
      commitId: action.commitId,
      commitMessage: action.commitMessage,
    }).catch((err) => {
      logger.errorWithCause(err, "inbound.dispatch.diagnostic: failed", {
        serviceId: action.serviceId,
      });
      return null;
    });

    if (result) {
      logger.info("inbound.dispatch.diagnostic: session created", {
        sessionId: result.sessionId,
        runId: result.runId,
        serviceId: action.serviceId,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Coalesce — cancel stale runs for a PR, then execute the nested action
  // -------------------------------------------------------------------------

  private async dispatchCoalesce(action: CoalesceAction): Promise<void> {
    await this.cancelActiveRunsForPR(action.repo, action.prNumber);
    await this.dispatch(action.then);
  }

  private async cancelActiveRunsForPR(
    repoPath: string,
    prNumber: number,
  ): Promise<void> {
    const { db } = this.deps;

    const matchingSessions = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.repoPath, repoPath),
          eq(sessions.prNumber, prNumber),
          inArray(sessions.status, ["running", "completed"]),
        ),
      );

    if (matchingSessions.length === 0) return;

    const sessionIds = matchingSessions.map((s) => s.id);

    const activeRuns = await db
      .select({ id: agentRuns.id, sessionId: agentRuns.sessionId })
      .from(agentRuns)
      .where(
        and(
          inArray(agentRuns.sessionId, sessionIds),
          inArray(agentRuns.status, ["queued", "running"]),
        ),
      );

    if (activeRuns.length === 0) return;

    const runIds = activeRuns.map((r) => r.id);
    await db
      .update(agentRuns)
      .set({ status: "aborted" })
      .where(inArray(agentRuns.id, runIds));

    logger.info("inbound.coalesce: cancelled active runs", {
      repo: repoPath,
      prNumber,
      cancelledRunIds: runIds,
    });
  }

  // -------------------------------------------------------------------------
  // Session matching
  // -------------------------------------------------------------------------

  private async matchSessions(
    matcher: SessionMatcher,
  ): Promise<Array<typeof sessions.$inferSelect>> {
    const { db } = this.deps;

    switch (matcher.by) {
      case "repo_pr":
        return db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.repoPath, matcher.repo),
              eq(sessions.prNumber, matcher.prNumber),
            ),
          )
          .orderBy(desc(sessions.updatedAt));

      case "repo_branch":
        if (!matcher.branch) return [];
        return db
          .select()
          .from(sessions)
          .where(
            and(
              eq(sessions.repoPath, matcher.repo),
              eq(sessions.branch, matcher.branch),
            ),
          )
          .orderBy(desc(sessions.updatedAt));
    }
  }
}

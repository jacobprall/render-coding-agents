import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ciEvents, sessions } from "@coding-agents/db";
import { logger, ValidationError } from "@coding-agents/shared";
import type { PlatformDb } from "../interfaces/database";
import type { QueueAdapter } from "../interfaces/queue";
import {
  enqueueSessionTriggerJob as enqueueSessionTriggerJobImpl,
  getForgeProviderForSession,
} from "./session-agent-jobs";

// ---------------------------------------------------------------------------
// CI Result Payload schema (Zod)
// ---------------------------------------------------------------------------

const ciStepResultSchema = z.object({
  name: z.string(),
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number(),
});

const ciJobResultSchema = z.object({
  name: z.string(),
  status: z.enum(["success", "failure", "error"]),
  steps: z.array(ciStepResultSchema),
  durationMs: z.number(),
});

export const ciResultPayloadSchema = z.object({
  ciEventId: z.string().min(1),
  workflowName: z.string(),
  status: z.enum(["success", "failure", "error"]),
  jobs: z.array(ciJobResultSchema),
  testResults: z
    .object({
      junitXml: z.string().optional(),
      tapOutput: z.string().optional(),
    })
    .optional(),
  totalDurationMs: z.number(),
});

export type CIResultPayload = z.infer<typeof ciResultPayloadSchema>;

// ---------------------------------------------------------------------------
// CIService
// ---------------------------------------------------------------------------

export class CIService {
  constructor(
    private db: PlatformDb,
    private queue: QueueAdapter,
  ) {}

  // -------------------------------------------------------------------------
  // handleResult — POST /api/ci/results
  // -------------------------------------------------------------------------

  /**
   * Process a CI result callback from an external runner (e.g. GitHub Actions).
   * Validates CI_RUNNER_SECRET when set, updates the ciEvent row, posts commit
   * status on the forge, and optionally enqueues an agent fix job on failure.
   *
   * @param secret - The value from the x-ci-secret header (empty string if absent).
   */
  async handleResult(secret: string, payload: CIResultPayload): Promise<void> {
    const configuredSecret = process.env.CI_RUNNER_SECRET;
    if (configuredSecret) {
      if (!timingSafeEqualUtf8(secret, configuredSecret)) {
        throw new ValidationError("Invalid CI runner secret");
      }
    }

    const [event] = await this.db
      .select()
      .from(ciEvents)
      .where(eq(ciEvents.id, payload.ciEventId))
      .limit(1);

    if (!event) {
      logger.warn("ci result: ci_events row not found", { ciEventId: payload.ciEventId });
      return;
    }

    if (event.processed) {
      logger.info("ci result: duplicate callback ignored", { ciEventId: payload.ciEventId });
      return;
    }

    const existingPayload =
      event.payload && typeof event.payload === "object"
        ? (event.payload as Record<string, unknown>)
        : {};

    const rowStatus: "success" | "failure" | "error" =
      payload.status === "success" ? "success" : payload.status === "error" ? "error" : "failure";

    const rowType: "ci_success" | "ci_failure" =
      payload.status === "success" ? "ci_success" : "ci_failure";

    await this.db
      .update(ciEvents)
      .set({
        status: rowStatus,
        type: rowType,
        payload: buildStoredPayload(payload, existingPayload),
        processed: true,
      })
      .where(eq(ciEvents.id, payload.ciEventId));

    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, event.sessionId))
      .limit(1);

    if (!session) return;

    if (!session.repoPath) return;
    const [repoOwner, repoName] = session.repoPath.split("/");
    if (!repoOwner || !repoName) return;

    const commitSha =
      typeof existingPayload.commitSha === "string" ? existingPayload.commitSha : undefined;

    try {
      const forge = await getForgeProviderForSession(this.db, session);

      let sha = commitSha;
      if (!sha) {
        const branches = await forge.branches.list(repoOwner, repoName);
        const branchRow = branches.find((b) => b.name === session.branch);
        sha = branchRow?.commitSha;
      }

      if (sha) {
        const logsUrl = buildLogsUrl(session.repoPath, payload.ciEventId);
        const state: "pending" | "success" | "failure" | "error" =
          payload.status === "success"
            ? "success"
            : payload.status === "error"
              ? "error"
              : "failure";

        await forge.commits.createStatus(repoOwner, repoName, sha, {
          state,
          context: `ci/${payload.workflowName}`,
          description: buildStatusDescription(payload),
          targetUrl: logsUrl,
        });
      }
    } catch (err) {
      logger.warn("ci result: failed to post commit status", {
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    if (payload.status === "failure" && session.status === "running") {
      await this.enqueueAgentFixJob(session, payload);
    }
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private async enqueueAgentFixJob(
    session: typeof sessions.$inferSelect,
    payload: CIResultPayload,
  ): Promise<void> {
    const failedSteps = payload.jobs
      .flatMap((j) => j.steps.filter((s) => s.exitCode !== 0))
      .slice(0, 3);

    const failureSummary = failedSteps
      .map((s) => {
        const output = (s.stderr || s.stdout).slice(0, 500);
        return `Step "${s.name}" failed (exit ${s.exitCode}):\n${output}`;
      })
      .join("\n\n");

    const fixContext = [
      `CI workflow "${payload.workflowName}" failed.`,
      failureSummary || "No detailed output available.",
      "Review the failures above and fix the code.",
    ].join("\n\n");

    try {
      await enqueueSessionTriggerJobImpl(this.db, this.queue, {
        sessionRow: session,
        userId: session.userId,
        trigger: "ci_failure",
        fixContext,
      });
    } catch (err) {
      logger.errorWithCause(err, "ci result: failed to enqueue fix job", {
        sessionId: session.id,
      });
    }
  }

  enqueueSessionTriggerJob(
    params: Parameters<typeof enqueueSessionTriggerJobImpl>[2],
  ): Promise<Awaited<ReturnType<typeof enqueueSessionTriggerJobImpl>>> {
    return enqueueSessionTriggerJobImpl(this.db, this.queue, params);
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function buildStoredPayload(
  payload: CIResultPayload,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const stored: Record<string, unknown> = {
    status: payload.status,
    workflowName: payload.workflowName,
    totalDurationMs: payload.totalDurationMs,
    jobs: payload.jobs.map((j) => ({
      name: j.name,
      status: j.status,
      durationMs: j.durationMs,
      steps: j.steps.map((s) => ({
        name: s.name,
        exitCode: s.exitCode,
        durationMs: s.durationMs,
        stdout: s.stdout.slice(0, 10_000),
        stderr: s.stderr.slice(0, 10_000),
      })),
    })),
  };

  if (typeof existing.commitSha === "string") {
    stored.commitSha = existing.commitSha;
  }
  if (payload.testResults?.junitXml) {
    stored.junit_xml = payload.testResults.junitXml;
  }
  if (payload.testResults?.tapOutput) {
    stored.tap_output = payload.testResults.tapOutput;
  }

  return stored;
}

function buildStatusDescription(payload: CIResultPayload): string {
  if (payload.status === "success") {
    return `CI passed in ${(payload.totalDurationMs / 1000).toFixed(1)}s`;
  }
  if (payload.status === "error") {
    return "CI runner error";
  }
  const failedJob = payload.jobs.find((j) => j.status === "failure");
  const failedStep = failedJob?.steps.find((s) => s.exitCode !== 0);
  if (failedStep) {
    return `Failed: ${failedStep.name} (exit ${failedStep.exitCode})`;
  }
  return "CI failed";
}

function buildLogsUrl(repoPath: string, _ciEventId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:4000";
  return `${base}/${repoPath}`;
}

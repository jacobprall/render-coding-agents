import type Redis from "ioredis";
import type { EventBus, PlatformDb } from "@coding-agents/platform";
import type { SandboxAdapter } from "@coding-agents/sandbox";
import type { AgentJob } from "../types";
import { publishEvent, evt } from "../run-persistence";
import { runPlanner, type PlanResult } from "../planner";
import { finalizePlanRejected } from "./run-terminal";

const APPROVAL_POLL_INTERVAL_MS = 2000;
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000;

export type PlanningPhaseResult =
  | { status: "skipped" }
  | { status: "rejected" }
  | { status: "approved"; plan: PlanResult };

export async function runPlanningPhaseIfNeeded(params: {
  job: AgentJob;
  redis: Redis;
  events: EventBus;
  db: PlatformDb;
  adapter: SandboxAdapter;
  enabled: boolean;
  isContinuation: boolean;
}): Promise<PlanningPhaseResult> {
  const { job, redis, events, db, adapter, enabled, isContinuation } = params;

  if (!enabled || isContinuation) {
    return { status: "skipped" };
  }

  console.info(`[agent][${job.runId}] entering planning phase`);
  const plan = await runPlanner({ job, redis, events, db, adapter });

  await events.setKey(`run:${job.runId}:awaiting_approval`, "1", APPROVAL_TIMEOUT_MS / 1000);

  const approvalStart = Date.now();
  while (Date.now() - approvalStart < APPROVAL_TIMEOUT_MS) {
    const steeringEvents = await events.consumeSteering(job.runId);
    const approval = steeringEvents.find(
      (e) => e.type === "user:plan_approved" || e.type === "user:plan_rejected",
    );
    if (!approval) {
      await new Promise((r) => setTimeout(r, APPROVAL_POLL_INTERVAL_MS));
      continue;
    }

    const waitMs = Date.now() - approvalStart;
    if (approval.type === "user:plan_rejected") {
      console.info(`[agent][${job.runId}] plan rejected`, { waitMs, reason: approval.reason });
      await finalizePlanRejected({ db, events, redis, job, reason: approval.reason ?? "rejected" });
      return { status: "rejected" };
    }

    console.info(`[agent][${job.runId}] plan approved`, { waitMs });
    await publishEvent(
      events,
      job.runId,
      evt("plan:approved", { reason: approval.reason }),
      job.requestId,
    );
    return { status: "approved", plan };
  }

  console.info(`[agent][${job.runId}] plan approval timeout`);
  await finalizePlanRejected({ db, events, redis, job, reason: "approval_timeout" });
  return { status: "rejected" };
}

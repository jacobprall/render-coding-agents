/**
 * Redis Streams queue for agent jobs.
 *
 * At-least-once delivery: jobs stay in the Pending Entry List (PEL)
 * until acknowledged. If a worker dies before ackJob(), the entry is
 * reclaimed by the next available worker via reclaimStalePending().
 */
import type Redis from "ioredis";
import { z } from "zod";

export const AGENT_JOBS_STREAM = "agent:jobs:stream";
export const AGENT_JOBS_GROUP = "agent-workers";
const PAYLOAD_FIELD = "payload";

export const ActiveSkillRefSchema = z.object({
  source: z.enum(["builtin", "user", "repo"]),
  slug: z.string(),
});

export const AgentJobSchema = z.object({
  runId: z.string().min(1),
  chatId: z.string().min(1),
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.unknown(),
    }),
  ),
  modelMessages: z.array(z.unknown()).optional(),
  activeSkillRefs: z.array(ActiveSkillRefSchema),
  projectConfig: z.unknown().optional(),
  projectContext: z.string().nullish(),
  modelId: z.string().optional(),
  fixContext: z.string().optional(),
  trigger: z
    .enum(["user_message", "ci_failure", "review_comment", "pr_opened", "pr_merged", "workflow_run", "deploy_failure"])
    .optional(),
  requestId: z.string().optional(),
  retryCount: z.number().int().min(0).optional(),
  maxRetries: z.number().int().min(0).max(50).optional(),
  workspaceId: z.string().optional(),
  resolvedEnv: z.record(z.string(), z.string()).optional(),
  resolvedSecrets: z.record(z.string(), z.string()).optional(),
  resolvedSkills: z.array(ActiveSkillRefSchema).optional(),
  repos: z.array(z.object({
    repoPath: z.string(),
    forgeType: z.enum(["github", "gitlab"]).nullable(),
    defaultBranch: z.string(),
    isPrimary: z.boolean(),
  })).optional(),
});

export type ValidatedAgentJob = z.infer<typeof AgentJobSchema>;
export type ValidatedActiveSkillRef = z.infer<typeof ActiveSkillRefSchema>;

export async function ensureConsumerGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup("CREATE", AGENT_JOBS_STREAM, AGENT_JOBS_GROUP, "$", "MKSTREAM");
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("BUSYGROUP")) {
      throw err;
    }
  }
}

export async function enqueueJob(
  redis: Redis,
  job: Record<string, unknown>,
): Promise<string> {
  const id = await redis.xadd(
    AGENT_JOBS_STREAM,
    "*",
    PAYLOAD_FIELD,
    JSON.stringify(job),
  );
  if (!id) throw new Error("xadd returned null — stream may be at MAXLEN");
  return id;
}

export async function readOneJob(
  redis: Redis,
  consumerId: string,
  blockMs: number,
): Promise<{ streamId: string; job: ValidatedAgentJob } | null> {
  const result = await redis.xreadgroup(
    "GROUP",
    AGENT_JOBS_GROUP,
    consumerId,
    "COUNT",
    1,
    "BLOCK",
    blockMs,
    "STREAMS",
    AGENT_JOBS_STREAM,
    ">",
  ) as [string, [string, string[]][]][] | null;

  if (!result) return null;

  const first = result[0];
  if (!first) return null;
  const [, entries] = first;
  if (!entries || entries.length === 0) return null;

  const entry = entries[0];
  if (!entry) return null;
  const [streamId, fields] = entry;

  let rawPayload: string | undefined;
  for (let i = 0; i < fields.length - 1; i += 2) {
    if (fields[i] === PAYLOAD_FIELD) {
      rawPayload = fields[i + 1];
      break;
    }
  }

  if (!rawPayload) {
    console.error("[queue] Entry missing payload field, discarding:", streamId);
    await ackJob(redis, streamId);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    console.error("[queue] Failed to parse job JSON, discarding:", streamId);
    await ackJob(redis, streamId);
    return null;
  }

  const validation = AgentJobSchema.safeParse(parsed);
  if (!validation.success) {
    console.error("[queue] Invalid job schema, discarding:", streamId, validation.error.message);
    await ackJob(redis, streamId);
    return null;
  }

  return { streamId, job: validation.data };
}

export async function ackJob(redis: Redis, streamId: string): Promise<void> {
  await redis.xack(AGENT_JOBS_STREAM, AGENT_JOBS_GROUP, streamId);
}

export async function reclaimStalePending(
  redis: Redis,
  consumerId: string,
  minIdleMs = 60_000,
): Promise<{ deadLetters: Array<{ streamId: string; job: ValidatedAgentJob }> }> {
  const deadLetters: Array<{ streamId: string; job: ValidatedAgentJob }> = [];

  const pending = await redis.xpending(
    AGENT_JOBS_STREAM,
    AGENT_JOBS_GROUP,
    "-",
    "+",
    100,
  ) as Array<[string, string, number, number]> | null;

  if (!pending || pending.length === 0) return { deadLetters };

  const stale = pending.filter(([, , idle]) => idle >= minIdleMs);
  if (stale.length === 0) return { deadLetters };

  const ids = stale.map(([id]) => id);
  const claimed = await redis.xclaim(
    AGENT_JOBS_STREAM,
    AGENT_JOBS_GROUP,
    consumerId,
    minIdleMs,
    ...ids,
  ) as [string, string[]][] | null;

  if (!claimed) return { deadLetters };

  for (const [streamId, fields] of claimed) {
    let rawPayload: string | undefined;
    for (let i = 0; i < fields.length - 1; i += 2) {
      if (fields[i] === PAYLOAD_FIELD) {
        rawPayload = fields[i + 1];
        break;
      }
    }
    if (!rawPayload) {
      await ackJob(redis, streamId);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      await ackJob(redis, streamId);
      continue;
    }

    const validation = AgentJobSchema.safeParse(parsed);
    if (!validation.success) {
      await ackJob(redis, streamId);
      continue;
    }

    const job = validation.data;
    const nextRetry = (job.retryCount ?? 0) + 1;
    const maxR = job.maxRetries ?? 3;

    await ackJob(redis, streamId);

    // Skip re-enqueue if the run is still actively being processed
    const runStatus = await redis.get(`run:${job.runId}:status`);
    if (runStatus === "running") {
      continue;
    }

    if (nextRetry > maxR) {
      deadLetters.push({ streamId, job: { ...job, retryCount: nextRetry } });
      continue;
    }

    await enqueueJob(redis, { ...job, retryCount: nextRetry } as Record<string, unknown>);
  }

  return { deadLetters };
}

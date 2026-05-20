import type { LanguageModel, ToolSet } from "ai";
import type Redis from "ioredis";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { specs } from "@openforge/db";
import type { PlatformDb, EventBus } from "@openforge/platform";
import {
  bashTool,
  readFileTool,
  writeFileTool,
  globTool,
  grepTool,
  gitTool,
  createPullRequestTool,
  editFileTool,
  webFetchTool,
  taskTool,
  todoWriteTool,
  askUserQuestionTool,
  mergePrTool,
  closePrTool,
  addPrCommentTool,
  requestReviewTool,
  approvePrTool,
  createRepoTool,
  readBuildLogTool,
  pullRequestDiffTool,
  reviewPrTool,
  resolveCommentTool,
  submitSpecTool,
  type SubmitSpecInput,
  attachRepoTool,
} from "./tools";
import type { AgentJob, StreamEvent } from "./types";
import { publishEvent } from "./run-persistence";
import { applyTrustTiers } from "./trust-tiers";

// ─── Tool registry ───────────────────────────────────────────────────────────

function coreTools(): ToolSet {
  return {
    bash: bashTool(),
    read_file: readFileTool(),
    write_file: writeFileTool(),
    edit: editFileTool(),
    glob: globTool(),
    grep: grepTool(),
    web_fetch: webFetchTool(),
  };
}

function repoTools(): ToolSet {
  return {
    git: gitTool(),
    create_pull_request: createPullRequestTool(),
  };
}

export function buildSubagentToolSet(hasRepo = true): ToolSet {
  return hasRepo
    ? { ...coreTools(), ...repoTools() }
    : coreTools();
}

export function buildToolSet(
  events: EventBus,
  redis: Redis,
  db: PlatformDb,
  job: AgentJob,
  model: LanguageModel,
  skillsPromptSuffix: string,
  hasRepo = true,
): ToolSet {
  const reqId = job.requestId;
  const makeSubTools = () => buildSubagentToolSet(hasRepo);
  const publishFn = async (event: Record<string, unknown>) => {
    await publishEvent(events, job.runId, event as unknown as StreamEvent, reqId);
  };
  const baseTools = applyTrustTiers(
    makeSubTools(),
    job.runId,
    () => redis.duplicate(),
    publishFn,
  );

  const tools: ToolSet = {
    ...baseTools,
    task: taskTool(
      publishFn,
      makeSubTools,
      model,
      skillsPromptSuffix,
    ),
    todo_write: todoWriteTool(),
    ask_user_question: askUserQuestionTool(job.runId, () => redis.duplicate(), publishFn),
  };

  if (!hasRepo) {
    tools.attach_repo = attachRepoTool(db, job.sessionId);
  }

  if (hasRepo) {
    tools.merge_pr = mergePrTool();
    tools.close_pr = closePrTool();
    tools.add_pr_comment = addPrCommentTool();
    tools.request_review = requestReviewTool();
    tools.approve_pr = approvePrTool();
    tools.create_repo = createRepoTool();
    tools.read_build_log = readBuildLogTool();
    tools.pull_request_diff = pullRequestDiffTool();
    tools.review_pr = reviewPrTool();
    tools.resolve_comment = resolveCommentTool();
    tools.submit_spec = submitSpecTool(
      async (event) => {
        await publishEvent(events, job.runId, event, reqId);
      },
      async (spec) => {
        await persistSubmittedSpec(db, job.sessionId, spec);
      },
    );
  }

  return tools;
}

async function persistSubmittedSpec(db: PlatformDb, sessionId: string, spec: SubmitSpecInput): Promise<void> {
  const [latest] = await db
    .select()
    .from(specs)
    .where(eq(specs.sessionId, sessionId))
    .orderBy(desc(specs.version))
    .limit(1);

  await db.insert(specs).values({
    id: nanoid(),
    sessionId,
    version: (latest?.version ?? 0) + 1,
    status: "draft",
    goal: spec.goal,
    approach: spec.approach,
    filesToModify: spec.filesToModify ?? [],
    filesToCreate: spec.filesToCreate ?? [],
    risks: spec.risks ?? [],
    outOfScope: spec.outOfScope ?? [],
    verificationPlan: spec.verificationPlan,
    estimatedComplexity: spec.estimatedComplexity ?? "small",
    createdAt: new Date(),
  });
}

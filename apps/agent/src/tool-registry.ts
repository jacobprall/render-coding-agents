import type Redis from "ioredis";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { specs } from "@coding-agents/db";
import type { PlatformDb, EventBus } from "@coding-agents/platform";
import type { LLMProvider } from "./llm";
import type { ToolConfig } from "./tools/define-tool";
import type { SubagentModelResolver } from "./tools/task";
import type { AgentTool } from "./loop";
import type { ObservabilityRecorder } from "./observability";
import type { ForgeAgentContext } from "./context/agent-context";
import { zodToJsonSchema } from "./zod-to-json-schema";
import { getModel } from "./models";
import type { ResolvedLlmKeys } from "@coding-agents/platform";
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
  loadSkillTool,
  resetSkillCache,
  getToolResultTool,
} from "./tools";
import type { AgentJob, StreamEvent } from "./types";
import { publishEvent } from "./run-persistence";

// ─── Tool config registries ──────────────────────────────────────────────────

type ToolConfigSet = Record<string, ToolConfig>;

function coreTools(): ToolConfigSet {
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

function repoTools(): ToolConfigSet {
  return {
    git: gitTool(),
    create_pull_request: createPullRequestTool(),
  };
}

export function buildSubagentToolConfigs(hasRepo = true): ToolConfigSet {
  return hasRepo
    ? { ...coreTools(), ...repoTools() }
    : coreTools();
}

/**
 * Convert a set of ToolConfig objects into a Map<string, AgentTool> for the
 * agent loop, injecting the provided context into each tool's execute.
 */
export function toolConfigsToAgentTools(
  configs: ToolConfigSet,
  context: unknown,
): Map<string, AgentTool> {
  const tools = new Map<string, AgentTool>();
  for (const [name, cfg] of Object.entries(configs)) {
    tools.set(name, {
      definition: {
        name,
        description: cfg.description,
        input_schema: zodToJsonSchema(cfg.inputSchema),
      },
      execute: (input, toolCallId, options) => {
        const parsed = cfg.inputSchema.parse(input);
        return cfg.execute(parsed, { context, toolCallId, abortSignal: options?.signal });
      },
    });
  }
  return tools;
}

const SUBAGENT_DEFAULT_MODEL = process.env.SUBAGENT_DEFAULT_MODEL ?? "anthropic/claude-haiku-4-5";

function buildSubagentModelResolver(
  parentProvider: LLMProvider,
  parentModelId: string,
  llmKeys: ResolvedLlmKeys,
): SubagentModelResolver {
  return {
    resolve(requestedModelId?: string) {
      const targetId = requestedModelId || SUBAGENT_DEFAULT_MODEL;
      try {
        return getModel(targetId, llmKeys);
      } catch {
        return { provider: parentProvider, modelId: parentModelId, providerName: "anthropic" };
      }
    },
  };
}

export interface BuildToolSetOptions {
  events: EventBus;
  redis: Redis;
  db: PlatformDb;
  job: AgentJob;
  provider: LLMProvider;
  modelId: string;
  forgeContext: ForgeAgentContext;
  skillsPromptSuffix: string;
  hasRepo?: boolean;
  resultStore?: Map<string, string>;
  llmKeys?: ResolvedLlmKeys;
  signal?: AbortSignal;
  recorder?: ObservabilityRecorder;
  secrets?: Record<string, string>;
}

export function buildToolSet(options: BuildToolSetOptions): Map<string, AgentTool> {
  const {
    events,
    redis,
    db,
    job,
    provider,
    modelId,
    forgeContext,
    skillsPromptSuffix,
    hasRepo = true,
    resultStore = new Map<string, string>(),
    llmKeys,
    signal,
    recorder,
    secrets,
  } = options;

  const reqId = job.requestId;
  const makeSubToolConfigs = () => buildSubagentToolConfigs(hasRepo);
  const publishFn = async (event: StreamEvent) => {
    await publishEvent(events, job.runId, event, reqId);
  };

  const baseConfigs = makeSubToolConfigs();

  resetSkillCache();

  const modelResolver = buildSubagentModelResolver(
    provider,
    modelId,
    llmKeys ?? ({} as ResolvedLlmKeys),
  );

  const allConfigs: ToolConfigSet = {
    ...baseConfigs,
    task: taskTool(
      publishFn,
      makeSubToolConfigs,
      modelResolver,
      forgeContext,
      skillsPromptSuffix,
      { signal, recorder, secrets, resultStore },
    ),
    todo_write: todoWriteTool(),
    ask_user_question: askUserQuestionTool(job.runId, () => redis.duplicate(), publishFn),
    load_skill: loadSkillTool(),
    get_tool_result: getToolResultTool(resultStore, job.resolvedSecrets),
  };

  if (!hasRepo) {
    allConfigs.attach_repo = attachRepoTool(db, job.sessionId);
  }

  if (hasRepo) {
    allConfigs.merge_pr = mergePrTool();
    allConfigs.close_pr = closePrTool();
    allConfigs.add_pr_comment = addPrCommentTool();
    allConfigs.request_review = requestReviewTool();
    allConfigs.approve_pr = approvePrTool();
    allConfigs.create_repo = createRepoTool();
    allConfigs.read_build_log = readBuildLogTool();
    allConfigs.pull_request_diff = pullRequestDiffTool();
    allConfigs.review_pr = reviewPrTool();
    allConfigs.resolve_comment = resolveCommentTool();
    allConfigs.submit_spec = submitSpecTool(
      async (event) => {
        await publishEvent(events, job.runId, event, reqId);
      },
      async (spec) => {
        await persistSubmittedSpec(db, job.sessionId, spec);
      },
    );
  }

  return toolConfigsToAgentTools(allConfigs, forgeContext);
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

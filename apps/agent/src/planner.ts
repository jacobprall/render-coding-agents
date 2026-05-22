import type Redis from "ioredis";
import type { EventBus, PlatformDb } from "@coding-agents/platform";
import type { SandboxAdapter } from "@coding-agents/sandbox";
import type { AgentJob, StreamEvent } from "./types";
import type { ToolConfig } from "./tools/define-tool";
import { publishEvent } from "./run-persistence";
import { toolConfigsToAgentTools } from "./tool-registry";
import { agentLoop } from "./loop";
import { getModel } from "./models";
import { resolveLlmApiKeys } from "@coding-agents/platform";
import {
  readFileTool,
  globTool,
  grepTool,
  gitTool,
} from "./tools";

export interface PlanResult {
  plan: string;
  reasoning: string;
  suggestedSteps: string[];
}

const PLANNER_MAX_STEPS = 20;

const PLANNER_SYSTEM_PROMPT = `You are a planning agent. Your job is to explore the codebase and produce a structured implementation plan.

You have READ-ONLY tools available: you can read files, search with glob/grep, and inspect git history. You CANNOT write files, execute commands, or push changes.

Based on the user's request and your exploration of the codebase, produce a plan with:
1. A clear summary of what needs to be done
2. Your reasoning about the approach
3. A list of concrete implementation steps

Format your final response as:

## Plan
<high-level summary of the plan>

## Reasoning
<why this approach was chosen, trade-offs considered>

## Steps
1. <step 1>
2. <step 2>
...

Be thorough in your exploration but efficient. Focus on understanding the relevant parts of the codebase before producing your plan.`;

function buildReadOnlyToolConfigs(): Record<string, ToolConfig> {
  return {
    read_file: readFileTool(),
    glob: globTool(),
    grep: grepTool(),
    git: gitTool(),
  };
}

function parsePlanOutput(text: string): PlanResult {
  const planMatch = text.match(/## Plan\s*\n([\s\S]*?)(?=## Reasoning|$)/);
  const reasoningMatch = text.match(/## Reasoning\s*\n([\s\S]*?)(?=## Steps|$)/);
  const stepsMatch = text.match(/## Steps\s*\n([\s\S]*?)$/);

  const plan = planMatch?.[1]?.trim() ?? text;
  const reasoning = reasoningMatch?.[1]?.trim() ?? "";
  const stepsRaw = stepsMatch?.[1]?.trim() ?? "";

  const suggestedSteps = stepsRaw
    .split("\n")
    .map((line) => line.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean);

  return { plan, reasoning, suggestedSteps };
}

export async function runPlanner(params: {
  job: AgentJob;
  redis: Redis;
  events: EventBus;
  db: PlatformDb;
  adapter: SandboxAdapter;
}): Promise<PlanResult> {
  const { job, events, db, adapter } = params;
  const reqId = job.requestId;

  await publishEvent(events, job.runId, { type: "planner:started" } as StreamEvent, reqId);

  const llmKeys = await resolveLlmApiKeys(db, job.userId);
  const { provider, modelId } = getModel(job.modelId, llmKeys);

  const toolConfigs = buildReadOnlyToolConfigs();

  const forgeContext = {
    __brand: "ForgeAgentContext" as const,
    sessionId: job.sessionId,
    projectId: null,
    adapter,
    forge: null as unknown,
    repoOwner: "",
    repoName: "",
    branch: "main",
    baseBranch: "main",
  };

  const tools = toolConfigsToAgentTools(toolConfigs, forgeContext);

  const userMessage = job.messages[job.messages.length - 1];
  const userContent = typeof userMessage?.content === "string"
    ? userMessage.content
    : JSON.stringify(userMessage?.content ?? "");

  const messages = [
    { role: "user" as const, content: [{ type: "text" as const, text: userContent }] },
  ];

  const startTime = Date.now();

  const result = await agentLoop({
    provider,
    model: modelId,
    system: PLANNER_SYSTEM_PROMPT,
    messages,
    tools,
    maxSteps: PLANNER_MAX_STEPS,
    onToken: (token) => {
      publishEvent(events, job.runId, { type: "planner:thinking", token } as unknown as StreamEvent, reqId).catch(() => {});
    },
  });

  const planResult = parsePlanOutput(result.text);
  const durationMs = Date.now() - startTime;

  await publishEvent(events, job.runId, {
    type: "planner:completed",
    durationMs,
  } as unknown as StreamEvent, reqId);

  await publishEvent(events, job.runId, {
    type: "plan:generated",
    plan: planResult,
  } as unknown as StreamEvent, reqId);

  return planResult;
}

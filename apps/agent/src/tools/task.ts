import { defineTool } from "./define-tool";
import type { ToolConfig } from "./define-tool";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { ForgeAgentContext } from "../context/agent-context";
import type { LLMProvider } from "../llm";
import { agentLoop } from "../loop";
import { toolConfigsToAgentTools } from "../tool-registry";
import type { ObservabilityRecorder } from "../observability";
import type { StreamEvent } from "../types";
import { evt } from "../run-persistence";

const MAX_SUBAGENT_STEPS = 20;

const taskInputSchema = z.object({
  task: z.string().describe("Description of the task for the subagent"),
  context: z.string().optional().describe("Additional context the subagent needs"),
  model: z
    .string()
    .optional()
    .describe(
      "Model ID to use for this subagent (e.g. 'anthropic/claude-haiku-4-5'). " +
        "Defaults to the configured subagent model. Use a stronger model for complex reasoning tasks.",
    ),
});

export interface SubagentModelResolver {
  resolve(requestedModelId?: string): {
    provider: LLMProvider;
    modelId: string;
    providerName: "anthropic" | "openai";
  };
}

export function taskTool(
  publishFn: (event: StreamEvent) => Promise<void>,
  buildSubTools: () => Record<string, ToolConfig>,
  modelResolver: SubagentModelResolver,
  forgeContext: ForgeAgentContext,
  parentSignals?: {
    signal?: AbortSignal;
    recorder?: ObservabilityRecorder;
    secrets?: Record<string, string>;
    resultStore?: Map<string, string>;
  },
) {
  return defineTool({
    description: "Delegate a self-contained subtask to a focused subagent. Use for parallelizable or isolated work.",
    inputSchema: taskInputSchema,
    execute: async ({ task, context: taskContext, model: requestedModel }) => {
      const taskId = nanoid();
      await publishFn(evt("step:started", { task, stepId: taskId }));

      try {
        const { provider: subProvider, modelId: subModelId } = modelResolver.resolve(requestedModel);

        const subTools = toolConfigsToAgentTools(buildSubTools(), forgeContext);

        const subSystem = [
          `You are a focused subagent completing a specific task.`,
          taskContext ?? "",
        ].filter(Boolean).join("\n\n");

        const result = await agentLoop({
          provider: subProvider,
          model: subModelId,
          system: subSystem,
          messages: [{ role: "user" as const, content: task }],
          tools: subTools,
          maxSteps: MAX_SUBAGENT_STEPS,
          signal: parentSignals?.signal,
          recorder: parentSignals?.recorder,
          secrets: parentSignals?.secrets,
          resultStore: parentSignals?.resultStore,
        });

        const summary = result.text || `Completed ${result.steps} steps with ${result.totalUsage.outputTokens} output tokens.`;
        await publishFn(evt("step:completed", { task, stepId: taskId, result: summary }));
        return { success: true, result: summary };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await publishFn(evt("step:failed", { task, stepId: taskId, error: message }));
        return { success: false, error: message };
      }
    },
  });
}

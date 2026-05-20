import { defineTool } from "./define-tool";
import type { ToolConfig } from "./define-tool";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getSandboxContext, isForgeAgentContext, type ForgeAgentContext } from "../context/agent-context";
import type { LLMProvider } from "../llm";
import { agentLoop } from "../loop";
import { zodToJsonSchema } from "../zod-to-json-schema";
import type { AgentTool } from "../loop";

const MAX_SUBAGENT_STEPS = 20;

const taskInputSchema = z.object({
  task: z.string().describe("Description of the task for the subagent"),
  context: z.string().optional().describe("Additional context the subagent needs"),
});

export function taskTool(
  publishFn: (event: Record<string, unknown>) => Promise<void>,
  buildSubTools: () => Record<string, ToolConfig>,
  provider: LLMProvider,
  modelId: string,
  forgeContext: ForgeAgentContext,
  parentSystemPromptSuffix?: string,
) {
  return defineTool({
    description: "Delegate a self-contained subtask to a focused subagent. Use for parallelizable or isolated work.",
    inputSchema: taskInputSchema,
    execute: async ({ task, context: taskContext }) => {
      const taskId = nanoid();
      await publishFn({ type: "task_start", task, taskId });

      try {
        const subToolConfigs = buildSubTools();
        const subTools = new Map<string, AgentTool>();

        for (const [name, cfg] of Object.entries(subToolConfigs)) {
          subTools.set(name, {
            definition: {
              name,
              description: cfg.description,
              input_schema: zodToJsonSchema(cfg.inputSchema),
            },
            execute: (input) => cfg.execute(input as never, { context: forgeContext }),
          });
        }

        const subSystem = [
          `You are a focused subagent completing a specific task.`,
          parentSystemPromptSuffix ?? "",
          taskContext ?? "",
        ].filter(Boolean).join("\n\n");

        const result = await agentLoop({
          provider,
          model: modelId,
          system: subSystem,
          messages: [{ role: "user" as const, content: task }],
          tools: subTools,
          maxSteps: MAX_SUBAGENT_STEPS,
        });

        await publishFn({ type: "task_done", task, taskId, result: result.text });
        return { success: true, result: result.text };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await publishFn({ type: "task_error", task, taskId, message });
        return { success: false, error: message };
      }
    },
  });
}

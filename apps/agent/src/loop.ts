import type { LLMProvider, LLMMessage, LLMResponse, ContentBlock, ToolDefinition } from "./llm";

export interface AgentTool {
  definition: ToolDefinition;
  execute: (input: unknown) => Promise<unknown>;
}

export interface AgentStep {
  text: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  toolResults: Array<{ toolCallId: string; output: unknown }>;
  usage: { inputTokens: number; outputTokens: number };
}

export interface AgentLoopResult {
  text: string;
  messages: LLMMessage[];
  totalUsage: { inputTokens: number; outputTokens: number };
  steps: number;
  hitStepLimit: boolean;
}

export async function agentLoop(params: {
  provider: LLMProvider;
  model: string;
  system: string;
  messages: LLMMessage[];
  tools: Map<string, AgentTool>;
  maxSteps: number;
  signal?: AbortSignal;
  thinking?: { type: "enabled" | "adaptive"; budgetTokens: number };
  onStep?: (step: AgentStep) => Promise<void>;
  shouldAbort?: () => Promise<boolean>;
  onToken?: (token: string) => void;
}): Promise<AgentLoopResult> {
  const {
    provider,
    model,
    system,
    messages: initialMessages,
    tools,
    maxSteps,
    signal,
    thinking,
    onStep,
    shouldAbort,
    onToken,
  } = params;

  const allMessages = [...initialMessages];
  const toolDefs = [...tools.values()].map((t) => t.definition);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let accumulatedText = "";
  let steps = 0;

  while (steps < maxSteps) {
    if (shouldAbort && (await shouldAbort())) {
      break;
    }

    const response: LLMResponse = await provider.chat({
      model,
      system,
      messages: allMessages,
      tools: toolDefs,
      signal,
      thinking,
      onToken,
    });

    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;
    steps++;

    const textBlocks = response.content.filter((b) => b.type === "text");
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");
    const stepText = textBlocks.map((b) => b.text ?? "").join("");
    accumulatedText += stepText;

    allMessages.push({
      role: "assistant",
      content: response.content,
    });

    if (toolUseBlocks.length === 0) {
      if (onStep) {
        await onStep({
          text: stepText,
          toolCalls: [],
          toolResults: [],
          usage: response.usage,
        });
      }
      break;
    }

    const stepToolCalls: AgentStep["toolCalls"] = [];
    const stepToolResults: AgentStep["toolResults"] = [];
    const resultBlocks: ContentBlock[] = [];

    for (const block of toolUseBlocks) {
      const toolCallId = block.id!;
      const toolName = block.name!;
      const input = block.input;

      stepToolCalls.push({ toolCallId, toolName, input });

      const tool = tools.get(toolName);
      if (!tool) {
        const errorResult = { error: `Unknown tool: ${toolName}` };
        stepToolResults.push({ toolCallId, output: errorResult });
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: toolCallId,
          content: JSON.stringify(errorResult),
          is_error: true,
        });
        continue;
      }

      try {
        const output = await tool.execute(input);
        const serialized = typeof output === "string" ? output : JSON.stringify(output);
        stepToolResults.push({ toolCallId, output });
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: toolCallId,
          content: serialized,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const errorResult = { error: errorMsg };
        stepToolResults.push({ toolCallId, output: errorResult });
        resultBlocks.push({
          type: "tool_result",
          tool_use_id: toolCallId,
          content: JSON.stringify(errorResult),
          is_error: true,
        });
      }
    }

    allMessages.push({
      role: "user",
      content: resultBlocks,
    });

    if (onStep) {
      await onStep({
        text: stepText,
        toolCalls: stepToolCalls,
        toolResults: stepToolResults,
        usage: response.usage,
      });
    }
  }

  return {
    text: accumulatedText,
    messages: allMessages.slice(initialMessages.length),
    totalUsage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    steps,
    hitStepLimit: steps >= maxSteps,
  };
}

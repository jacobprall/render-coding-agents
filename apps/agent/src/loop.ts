import type { LLMProvider, LLMMessage, LLMResponse, ContentBlock, ToolDefinition } from "./llm";
import type { ObservabilityRecorder } from "./observability";

export interface AgentTool {
  definition: ToolDefinition;
  execute: (input: unknown, toolCallId?: string) => Promise<unknown>;
}

export interface AgentStep {
  text: string;
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    durationMs?: number;
    startedAt?: Date;
    endedAt?: Date;
    status?: "success" | "error";
  }>;
  toolResults: Array<{ toolCallId: string; output: unknown }>;
  usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number };
}

export interface AgentLoopResult {
  text: string;
  messages: LLMMessage[];
  totalUsage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number };
  steps: number;
  hitStepLimit: boolean;
}

const COMPACTION_CHAR_THRESHOLD = 2000;
const COMPACTION_STALE_STEPS = 2;

/**
 * Replace large tool results from older steps with compact pointers.
 * The full content is stored in resultStore and retrievable via get_tool_result.
 */
function compactStaleToolResults(
  allMessages: LLMMessage[],
  resultStore: Map<string, string>,
  currentStep: number,
): void {
  let stepCounter = 0;
  const cutoffStep = currentStep - COMPACTION_STALE_STEPS;

  for (const msg of allMessages) {
    if (msg.role === "assistant") {
      const blocks = Array.isArray(msg.content) ? msg.content : [];
      if (blocks.some((b) => b.type === "tool_use")) {
        stepCounter++;
      }
    }

    if (msg.role !== "user" || typeof msg.content === "string") continue;
    if (stepCounter > cutoffStep) continue;

    const blocks = msg.content;
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      if (block.type !== "tool_result") continue;
      if (block.is_error) continue;

      const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
      if (content.length < COMPACTION_CHAR_THRESHOLD) continue;

      const toolCallId = block.tool_use_id;
      if (!toolCallId || resultStore.has(toolCallId)) continue;

      resultStore.set(toolCallId, content);

      const firstLine = content.slice(0, 100).split("\n")[0];
      const approxLines = content.split("\n").length;
      blocks[i] = {
        ...block,
        content: `[Compacted: ${approxLines} lines. Preview: "${firstLine}…". Use get_tool_result("${toolCallId}") to retrieve full content.]`,
      };
    }
  }
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
  resultStore?: Map<string, string>;
  recorder?: ObservabilityRecorder;
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
    resultStore = new Map<string, string>(),
    recorder,
  } = params;

  const allMessages = [...initialMessages];
  const toolDefs = [...tools.values()].map((t) => t.definition);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let accumulatedText = "";
  let steps = 0;

  while (steps < maxSteps) {
    if (shouldAbort && (await shouldAbort())) {
      break;
    }

    if (steps > 0) {
      compactStaleToolResults(allMessages, resultStore, steps);
    }

    const llmHandle = recorder?.startEvent("llm_request", {
      model,
      step: steps + 1,
      messageCount: allMessages.length,
      toolCount: toolDefs.length,
    });
    let response: LLMResponse;
    try {
      response = await provider.chat({
        model,
        system,
        messages: allMessages,
        tools: toolDefs,
        signal,
        thinking,
        onToken,
      });
      recorder?.endEvent(llmHandle ?? null, "success", {
        model: response.model,
        stopReason: response.stopReason,
        tokens: {
          input: response.usage.inputTokens,
          output: response.usage.outputTokens,
          cacheCreation: response.usage.cacheCreationInputTokens ?? 0,
          cacheRead: response.usage.cacheReadInputTokens ?? 0,
        },
      });
    } catch (error) {
      recorder?.endEvent(llmHandle ?? null, "error", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    totalInputTokens += response.usage.inputTokens;
    totalOutputTokens += response.usage.outputTokens;
    totalCacheCreation += response.usage.cacheCreationInputTokens ?? 0;
    totalCacheRead += response.usage.cacheReadInputTokens ?? 0;
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
      const startedAt = new Date();
      const toolHandle = recorder?.startEvent(
        "tool_call",
        { toolName, input },
        llmHandle?.id,
      );

      stepToolCalls.push({ toolCallId, toolName, input });

      const tool = tools.get(toolName);
      if (!tool) {
        const errorResult = { error: `Unknown tool: ${toolName}` };
        const endedAt = new Date();
        const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
        stepToolCalls[stepToolCalls.length - 1] = {
          ...stepToolCalls[stepToolCalls.length - 1],
          startedAt,
          endedAt,
          durationMs,
          status: "error",
        };
        recorder?.endEvent(toolHandle ?? null, "error", {
          toolCallId,
          durationMs,
          error: errorResult.error,
        });
        recorder?.maybeRecordSandboxEvent(toolHandle?.id, toolName, "error", {
          toolCallId,
          durationMs,
          error: errorResult.error,
        });
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
        const output = await tool.execute(input, toolCallId);
        const endedAt = new Date();
        const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
        stepToolCalls[stepToolCalls.length - 1] = {
          ...stepToolCalls[stepToolCalls.length - 1],
          startedAt,
          endedAt,
          durationMs,
          status: "success",
        };
        recorder?.endEvent(toolHandle ?? null, "success", {
          toolCallId,
          durationMs,
          output,
        });
        recorder?.maybeRecordSandboxEvent(toolHandle?.id, toolName, "success", {
          toolCallId,
          durationMs,
        });
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
        const endedAt = new Date();
        const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
        stepToolCalls[stepToolCalls.length - 1] = {
          ...stepToolCalls[stepToolCalls.length - 1],
          startedAt,
          endedAt,
          durationMs,
          status: "error",
        };
        recorder?.endEvent(toolHandle ?? null, "error", {
          toolCallId,
          durationMs,
          error: errorMsg,
        });
        recorder?.maybeRecordSandboxEvent(toolHandle?.id, toolName, "error", {
          toolCallId,
          durationMs,
          error: errorMsg,
        });
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
    totalUsage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cacheCreationInputTokens: totalCacheCreation || undefined,
      cacheReadInputTokens: totalCacheRead || undefined,
    },
    steps,
    hitStepLimit: steps >= maxSteps,
  };
}

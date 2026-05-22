import type { LLMProvider, LLMMessage, LLMResponse, ContentBlock, ToolDefinition } from "./llm";
import type { ObservabilityRecorder } from "./observability";

export interface AgentTool {
  definition: ToolDefinition;
  execute: (input: unknown, toolCallId?: string, options?: { signal?: AbortSignal }) => Promise<unknown>;
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

export type LoopTerminationReason = "end_turn" | "step_limit" | "empty_response" | "abort" | "max_tokens";

export interface AgentLoopResult {
  text: string;
  messages: LLMMessage[];
  totalUsage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number };
  steps: number;
  hitStepLimit: boolean;
  terminationReason: LoopTerminationReason;
}

const COMPACTION_CHAR_THRESHOLD = 2000;
const COMPACTION_STALE_STEPS = 2;
const MAX_EMPTY_RETRIES = 2;

const LLM_MAX_RETRIES = 3;
const LLM_RETRY_BACKOFF = [1000, 4000, 16000];

function isTransientLlmError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("rate limit") ||
    msg.includes("overloaded") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("529") ||
    msg.includes("network") ||
    msg.includes("econnreset") ||
    msg.includes("timeout")
  );
}

async function chatWithRetry(
  provider: LLMProvider,
  chatParams: Parameters<LLMProvider["chat"]>[0],
): Promise<LLMResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt < LLM_MAX_RETRIES; attempt++) {
    try {
      return await provider.chat(chatParams);
    } catch (err) {
      lastError = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      const isRetryable = isTransientLlmError(err);

      if (!isRetryable || attempt === LLM_MAX_RETRIES - 1) {
        throw err;
      }

      console.warn(`[agent-loop] LLM call failed (attempt ${attempt + 1}/${LLM_MAX_RETRIES}), retrying in ${LLM_RETRY_BACKOFF[attempt]}ms: ${errMsg}`);
      await new Promise((r) => setTimeout(r, LLM_RETRY_BACKOFF[attempt]));
    }
  }
  throw lastError;
}

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
  let terminationReason: LoopTerminationReason = "step_limit";
  let emptyRetries = 0;

  while (steps < maxSteps) {
    if (shouldAbort && (await shouldAbort())) {
      terminationReason = "abort";
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
      response = await chatWithRetry(provider, {
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

    if (response.stopReason === "tool_use" && toolUseBlocks.length === 0) {
      console.warn("[agent-loop] stopReason=tool_use but no tool blocks found, treating as empty response");
    }

    const stepText = textBlocks.map((b) => b.text ?? "").join("");
    accumulatedText += stepText;

    allMessages.push({
      role: "assistant",
      content: response.content,
    });

    if (toolUseBlocks.length === 0) {
      const hasText = textBlocks.some((b) => (b.text ?? "").trim().length > 0);

      if (hasText || response.stopReason === "max_tokens") {
        if (onStep) {
          await onStep({
            text: stepText,
            toolCalls: [],
            toolResults: [],
            usage: response.usage,
          });
        }
        terminationReason = response.stopReason === "max_tokens" ? "max_tokens" : "end_turn";
        break;
      }

      if (emptyRetries < MAX_EMPTY_RETRIES) {
        emptyRetries++;
        console.warn(`[agent-loop] Empty response (attempt ${emptyRetries}/${MAX_EMPTY_RETRIES}), retrying...`);
        onToken?.("");
        allMessages.pop();
        continue;
      }

      if (onStep) {
        await onStep({
          text: stepText,
          toolCalls: [],
          toolResults: [],
          usage: response.usage,
        });
      }
      terminationReason = "empty_response";
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
        const output = await tool.execute(input, toolCallId, { signal });
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
        if (signal?.aborted) {
          const endedAt = new Date();
          const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());
          stepToolCalls[stepToolCalls.length - 1] = {
            ...stepToolCalls[stepToolCalls.length - 1],
            startedAt,
            endedAt,
            durationMs,
            status: "error",
          };
          stepToolResults.push({ toolCallId, output: { error: "interrupted", interrupted: true } });
          resultBlocks.push({
            type: "tool_result",
            tool_use_id: toolCallId,
            content: JSON.stringify({ error: "Tool execution interrupted" }),
            is_error: true,
          });
          break;
        }
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
    terminationReason,
  };
}

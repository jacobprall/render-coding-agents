import type { LLMProvider, LLMResponse, LLMMessage, ContentBlock } from "./types";
import { forEachSseDataLine } from "./sse";

const API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 16384;

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  thinking?: string;
  signature?: string;
}

export function createAnthropicProvider(apiKey: string): LLMProvider {
  return {
    async chat(params) {
      const { model, system, messages, tools, maxTokens, signal, thinking, onToken } = params;

      const systemBlocks = [
        {
          type: "text",
          text: system,
          cache_control: { type: "ephemeral" },
        },
      ];

      const anthropicTools = tools.map((t, i) => {
        const tool: Record<string, unknown> = {
          name: t.name,
          description: t.description,
          input_schema: t.input_schema,
        };
        if (i === tools.length - 1) {
          tool.cache_control = { type: "ephemeral" };
        }
        return tool;
      });

      const convertedMessages = convertMessages(messages);
      markConversationPrefixForCaching(convertedMessages);

      const body: Record<string, unknown> = {
        model,
        system: systemBlocks,
        messages: convertedMessages,
        max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
      };

      if (anthropicTools.length > 0) {
        body.tools = anthropicTools;
      }

      if (thinking) {
        if (thinking.type === "adaptive") {
          body.thinking = { type: "adaptive" };
        } else {
          body.thinking = {
            type: thinking.type,
            budget_tokens: thinking.budgetTokens,
          };
        }
      }

      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "anthropic-beta": "prompt-caching-2024-07-31",
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
      }

      return parseSSEStream(res, onToken);
    },
  };
}

/**
 * Mark the last user-role message in the conversation for caching.
 * On multi-step calls, the entire prefix up to the cache breakpoint is
 * reused from Anthropic's server-side cache (0.1x cost vs 1.25x write).
 */
function markConversationPrefixForCaching(messages: unknown[]): void {
  if (messages.length < 2) return;

  for (let i = messages.length - 2; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg.role !== "user") continue;

    if (typeof msg.content === "string") {
      msg.content = [
        { type: "text", text: msg.content, cache_control: { type: "ephemeral" } },
      ];
    } else if (Array.isArray(msg.content) && msg.content.length > 0) {
      const lastBlock = msg.content[msg.content.length - 1] as Record<string, unknown>;
      lastBlock.cache_control = { type: "ephemeral" };
    }
    break;
  }
}

function convertMessages(messages: LLMMessage[]): unknown[] {
  return messages.filter((m) => m.role !== "system").map((m) => {
    if (typeof m.content === "string") {
      return { role: m.role, content: m.content };
    }
    return {
      role: m.role,
      content: m.content.map(convertBlock),
    };
  });
}

function convertBlock(block: ContentBlock): unknown {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text ?? "" };
    case "thinking":
      return {
        type: "thinking",
        thinking: block.thinking ?? "",
        ...(block.signature ? { signature: block.signature } : {}),
      };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
        ...(block.is_error ? { is_error: true } : {}),
      };
    default:
      return { type: "text", text: block.text ?? "" };
  }
}

async function parseSSEStream(
  res: Response,
  onToken?: (token: string) => void,
): Promise<LLMResponse> {
  const contentBlocks: AnthropicContentBlock[] = [];
  let stopReason = "end_turn";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let modelId = "";
  let inputPartial: Record<number, string> = {};

  await forEachSseDataLine(res, (event) => {
    const eventType = event.type as string;

    switch (eventType) {
      case "message_start": {
            const message = event.message as Record<string, unknown>;
            modelId = (message.model as string) ?? "";
            const usage = message.usage as Record<string, number> | undefined;
            if (usage) {
              inputTokens += usage.input_tokens ?? 0;
              outputTokens += usage.output_tokens ?? 0;
              cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
              cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
            }
        break;
      }
      case "content_block_start": {
            const idx = event.index as number;
            const block = event.content_block as AnthropicContentBlock;
            while (contentBlocks.length <= idx) {
              contentBlocks.push({ type: "text" });
            }
            contentBlocks[idx] = {
              type: block.type,
              id: block.id,
              name: block.name,
              input: block.type === "tool_use" ? undefined : block.input,
              text: block.text ?? "",
              thinking: block.thinking ?? "",
            };
            if (block.type === "tool_use") {
              inputPartial[idx] = "";
            }
        break;
      }
      case "content_block_delta": {
            const idx = event.index as number;
            const delta = event.delta as Record<string, unknown>;
            const deltaType = delta.type as string;
            const block = contentBlocks[idx];
            if (!block) break;

            if (deltaType === "text_delta") {
              const text = delta.text as string;
              block.text = (block.text ?? "") + text;
              onToken?.(text);
            } else if (deltaType === "thinking_delta") {
              block.thinking = (block.thinking ?? "") + (delta.thinking as string);
            } else if (deltaType === "signature_delta") {
              block.signature = (block.signature ?? "") + (delta.signature as string);
            } else if (deltaType === "input_json_delta") {
              if (idx in inputPartial) {
                inputPartial[idx] += delta.partial_json as string;
              }
            }
        break;
      }
      case "content_block_stop": {
            const idx = event.index as number;
            const block = contentBlocks[idx];
            if (block?.type === "tool_use" && idx in inputPartial) {
              try {
                block.input = JSON.parse(inputPartial[idx]!);
              } catch {
                block.input = {};
              }
              delete inputPartial[idx];
            }
        break;
      }
      case "message_delta": {
            const delta = event.delta as Record<string, unknown>;
            if (delta.stop_reason) {
              stopReason = delta.stop_reason as string;
            }
            const usage = event.usage as Record<string, number> | undefined;
            if (usage) {
              outputTokens += usage.output_tokens ?? 0;
              cacheCreationInputTokens += usage.cache_creation_input_tokens ?? 0;
              cacheReadInputTokens += usage.cache_read_input_tokens ?? 0;
            }
        break;
      }
    }
  });

  if (stopReason === "max_tokens") {
    console.warn("[anthropic] Response truncated: max_tokens reached");
  }

  const content: ContentBlock[] = contentBlocks.map((b) => {
    switch (b.type) {
      case "text":
        return { type: "text" as const, text: b.text ?? "" };
      case "thinking":
        return {
          type: "thinking" as const,
          thinking: b.thinking ?? "",
          ...(b.signature ? { signature: b.signature } : {}),
        };
      case "tool_use":
        return { type: "tool_use" as const, id: b.id, name: b.name, input: b.input };
      default:
        return { type: "text" as const, text: b.text ?? "" };
    }
  });

  return {
    content,
    stopReason: normalizeStopReason(stopReason),
    usage: {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens: cacheCreationInputTokens || undefined,
      cacheReadInputTokens: cacheReadInputTokens || undefined,
    },
    model: modelId,
  };
}

function normalizeStopReason(reason: string): LLMResponse["stopReason"] {
  switch (reason) {
    case "end_turn":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    default:
      return "end_turn";
  }
}

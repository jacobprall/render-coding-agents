import type { LLMProvider, LLMResponse, LLMMessage, ContentBlock, ToolDefinition } from "./types";

const API_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_MAX_TOKENS = 16384;

interface ToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export function createOpenAIProvider(apiKey: string): LLMProvider {
  return {
    async chat(params) {
      const { model, system, messages, tools, maxTokens, signal, onToken } = params;

      const openaiMessages = convertMessages(system, messages);

      const body: Record<string, unknown> = {
        model,
        messages: openaiMessages,
        max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
        stream: true,
      };

      if (tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        }));
      }

      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
      }

      return parseSSEStream(res, onToken);
    },
  };
}

function convertMessages(system: string, messages: LLMMessage[]): unknown[] {
  const result: unknown[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const m of messages) {
    if (m.role === "system") continue;

    if (typeof m.content === "string") {
      result.push({ role: m.role, content: m.content });
      continue;
    }

    if (m.role === "assistant") {
      const textParts = m.content.filter((b) => b.type === "text");
      const toolUseParts = m.content.filter((b) => b.type === "tool_use");

      const msg: Record<string, unknown> = { role: "assistant" };
      if (textParts.length > 0) {
        msg.content = textParts.map((b) => b.text).join("");
      }
      if (toolUseParts.length > 0) {
        msg.tool_calls = toolUseParts.map((b) => ({
          id: b.id,
          type: "function",
          function: {
            name: b.name,
            arguments: typeof b.input === "string" ? b.input : JSON.stringify(b.input),
          },
        }));
      }
      result.push(msg);
      continue;
    }

    if (m.role === "user") {
      const toolResults = m.content.filter((b) => b.type === "tool_result");
      if (toolResults.length > 0) {
        for (const tr of toolResults) {
          result.push({
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
          });
        }
      } else {
        const text = m.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("");
        result.push({ role: "user", content: text });
      }
    }
  }

  return result;
}

async function parseSSEStream(
  res: Response,
  onToken?: (token: string) => void,
): Promise<LLMResponse> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();

  let text = "";
  const toolCalls = new Map<number, AccumulatedToolCall>();
  let finishReason = "stop";
  let promptTokens = 0;
  let completionTokens = 0;
  let modelId = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;

        let chunk: Record<string, unknown>;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        if (!modelId && chunk.model) {
          modelId = chunk.model as string;
        }

        const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
        if (!choices?.length) {
          const usage = chunk.usage as Record<string, number> | undefined;
          if (usage) {
            promptTokens = usage.prompt_tokens ?? 0;
            completionTokens = usage.completion_tokens ?? 0;
          }
          continue;
        }

        const choice = choices[0]!;
        if (choice.finish_reason) {
          finishReason = choice.finish_reason as string;
        }

        const delta = choice.delta as Record<string, unknown> | undefined;
        if (!delta) continue;

        if (delta.content) {
          const token = delta.content as string;
          text += token;
          onToken?.(token);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls as ToolCallDelta[]) {
            let existing = toolCalls.get(tc.index);
            if (!existing) {
              existing = { id: tc.id ?? "", name: tc.function?.name ?? "", arguments: "" };
              toolCalls.set(tc.index, existing);
            }
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          }
        }

        if (chunk.usage) {
          const usage = chunk.usage as Record<string, number>;
          promptTokens = usage.prompt_tokens ?? promptTokens;
          completionTokens = usage.completion_tokens ?? completionTokens;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const content: ContentBlock[] = [];

  if (text) {
    content.push({ type: "text", text });
  }

  for (const [, tc] of [...toolCalls.entries()].sort((a, b) => a[0] - b[0])) {
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(tc.arguments);
    } catch {
      parsedArgs = {};
    }
    content.push({
      type: "tool_use",
      id: tc.id,
      name: tc.name,
      input: parsedArgs,
    });
  }

  return {
    content,
    stopReason: normalizeFinishReason(finishReason),
    usage: { inputTokens: promptTokens, outputTokens: completionTokens },
    model: modelId,
  };
}

function normalizeFinishReason(reason: string): LLMResponse["stopReason"] {
  switch (reason) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    default:
      return "end_turn";
  }
}

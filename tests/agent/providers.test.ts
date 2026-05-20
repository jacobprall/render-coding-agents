import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { createAnthropicProvider } from "../../apps/agent/src/llm/anthropic";
import { createOpenAIProvider } from "../../apps/agent/src/llm/openai";
import type { ToolDefinition } from "../../apps/agent/src/llm/types";

function sseLines(events: string[]): string {
  return events.map((e) => `data: ${e}`).join("\n") + "\n";
}

function readableStreamFrom(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function mockFetchResponse(sseText: string, status = 200): Response {
  return new Response(readableStreamFrom(sseText), {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

const dummyTools: ToolDefinition[] = [];
const baseChatParams = {
  model: "test-model",
  system: "You are a test assistant",
  messages: [{ role: "user" as const, content: "Hello" }],
  tools: dummyTools,
};

describe("Anthropic SSE parsing", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses a simple text response", async () => {
    const ssePayload = sseLines([
      JSON.stringify({
        type: "message_start",
        message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 20, output_tokens: 0 } },
      }),
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello " },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "world!" },
      }),
      JSON.stringify({ type: "content_block_stop", index: 0 }),
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 12 },
      }),
    ]);

    globalThis.fetch = async () => mockFetchResponse(ssePayload);

    const provider = createAnthropicProvider("test-key");
    const result = await provider.chat(baseChatParams);

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(result.content[0]!.text).toBe("Hello world!");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(20);
    expect(result.usage.outputTokens).toBe(12);
    expect(result.model).toBe("claude-sonnet-4-20250514");
  });

  it("parses tool_use blocks with streamed JSON input", async () => {
    const ssePayload = sseLines([
      JSON.stringify({
        type: "message_start",
        message: { model: "claude-sonnet-4-20250514", usage: { input_tokens: 30, output_tokens: 0 } },
      }),
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_01", name: "bash" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"com' },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: 'mand":"ls"}' },
      }),
      JSON.stringify({ type: "content_block_stop", index: 0 }),
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 8 },
      }),
    ]);

    globalThis.fetch = async () => mockFetchResponse(ssePayload);

    const provider = createAnthropicProvider("test-key");
    const result = await provider.chat(baseChatParams);

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("tool_use");
    expect(result.content[0]!.id).toBe("toolu_01");
    expect(result.content[0]!.name).toBe("bash");
    expect(result.content[0]!.input).toEqual({ command: "ls" });
    expect(result.stopReason).toBe("tool_use");
  });

  it("parses thinking blocks", async () => {
    const ssePayload = sseLines([
      JSON.stringify({
        type: "message_start",
        message: { model: "claude-opus-4-20250514", usage: { input_tokens: 10, output_tokens: 0 } },
      }),
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Let me think..." },
      }),
      JSON.stringify({ type: "content_block_stop", index: 0 }),
      JSON.stringify({
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Answer" },
      }),
      JSON.stringify({ type: "content_block_stop", index: 1 }),
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 20 },
      }),
    ]);

    globalThis.fetch = async () => mockFetchResponse(ssePayload);

    const provider = createAnthropicProvider("test-key");
    const result = await provider.chat(baseChatParams);

    expect(result.content).toHaveLength(2);
    expect(result.content[0]!.type).toBe("thinking");
    expect(result.content[0]!.thinking).toBe("Let me think...");
    expect(result.content[1]!.type).toBe("text");
    expect(result.content[1]!.text).toBe("Answer");
  });

  it("collects tokens via onToken callback", async () => {
    const ssePayload = sseLines([
      JSON.stringify({
        type: "message_start",
        message: { model: "test", usage: { input_tokens: 5, output_tokens: 0 } },
      }),
      JSON.stringify({
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "A" },
      }),
      JSON.stringify({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "B" },
      }),
      JSON.stringify({ type: "content_block_stop", index: 0 }),
      JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 2 },
      }),
    ]);

    globalThis.fetch = async () => mockFetchResponse(ssePayload);

    const tokens: string[] = [];
    const provider = createAnthropicProvider("test-key");
    await provider.chat({ ...baseChatParams, onToken: (t) => tokens.push(t) });

    expect(tokens).toEqual(["A", "B"]);
  });

  it("throws on non-OK HTTP responses", async () => {
    globalThis.fetch = async () =>
      new Response("rate limited", { status: 429 });

    const provider = createAnthropicProvider("test-key");
    await expect(provider.chat(baseChatParams)).rejects.toThrow("Anthropic API error 429");
  });
});

describe("OpenAI SSE parsing", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses a simple text response", async () => {
    const ssePayload = sseLines([
      JSON.stringify({
        model: "gpt-4o",
        choices: [{ delta: { content: "Hello " }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [{ delta: { content: "world!" }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 15, completion_tokens: 8 },
      }),
      "[DONE]",
    ]);

    globalThis.fetch = async () => mockFetchResponse(ssePayload);

    const provider = createOpenAIProvider("test-key");
    const result = await provider.chat(baseChatParams);

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(result.content[0]!.text).toBe("Hello world!");
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage.inputTokens).toBe(15);
    expect(result.usage.outputTokens).toBe(8);
    expect(result.model).toBe("gpt-4o");
  });

  it("parses tool_calls with streamed function arguments", async () => {
    const ssePayload = sseLines([
      JSON.stringify({
        model: "gpt-4o",
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_abc",
              function: { name: "read_file", arguments: "" },
            }],
          },
          finish_reason: null,
        }],
      }),
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '{"path":' },
            }],
          },
          finish_reason: null,
        }],
      }),
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: '"src/index.ts"}' },
            }],
          },
          finish_reason: null,
        }],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 25, completion_tokens: 15 },
      }),
      "[DONE]",
    ]);

    globalThis.fetch = async () => mockFetchResponse(ssePayload);

    const provider = createOpenAIProvider("test-key");
    const result = await provider.chat(baseChatParams);

    const toolBlock = result.content.find((b) => b.type === "tool_use");
    expect(toolBlock).toBeTruthy();
    expect(toolBlock!.id).toBe("call_abc");
    expect(toolBlock!.name).toBe("read_file");
    expect(toolBlock!.input).toEqual({ path: "src/index.ts" });
    expect(result.stopReason).toBe("tool_use");
  });

  it("normalizes OpenAI finish reasons to canonical stop reasons", async () => {
    const makePayload = (finishReason: string) => sseLines([
      JSON.stringify({
        model: "gpt-4o",
        choices: [{ delta: { content: "x" }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: finishReason }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      "[DONE]",
    ]);

    globalThis.fetch = async () => mockFetchResponse(makePayload("stop"));
    const provider = createOpenAIProvider("test-key");
    expect((await provider.chat(baseChatParams)).stopReason).toBe("end_turn");

    globalThis.fetch = async () => mockFetchResponse(makePayload("length"));
    expect((await provider.chat(baseChatParams)).stopReason).toBe("max_tokens");

    globalThis.fetch = async () => mockFetchResponse(makePayload("tool_calls"));
    expect((await provider.chat(baseChatParams)).stopReason).toBe("tool_use");
  });

  it("collects tokens via onToken callback", async () => {
    const ssePayload = sseLines([
      JSON.stringify({
        model: "gpt-4o",
        choices: [{ delta: { content: "X" }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [{ delta: { content: "Y" }, finish_reason: null }],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2 },
      }),
      "[DONE]",
    ]);

    globalThis.fetch = async () => mockFetchResponse(ssePayload);

    const tokens: string[] = [];
    const provider = createOpenAIProvider("test-key");
    await provider.chat({ ...baseChatParams, onToken: (t) => tokens.push(t) });

    expect(tokens).toEqual(["X", "Y"]);
  });

  it("throws on non-OK HTTP responses", async () => {
    globalThis.fetch = async () =>
      new Response("unauthorized", { status: 401 });

    const provider = createOpenAIProvider("test-key");
    await expect(provider.chat(baseChatParams)).rejects.toThrow("OpenAI API error 401");
  });

  it("handles multiple concurrent tool calls", async () => {
    const ssePayload = sseLines([
      JSON.stringify({
        model: "gpt-4o",
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "bash", arguments: "" } },
              { index: 1, id: "call_2", function: { name: "read_file", arguments: "" } },
            ],
          },
          finish_reason: null,
        }],
      }),
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: '{"command":"ls"}' } },
              { index: 1, function: { arguments: '{"path":"a.ts"}' } },
            ],
          },
          finish_reason: null,
        }],
      }),
      JSON.stringify({
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 30, completion_tokens: 20 },
      }),
      "[DONE]",
    ]);

    globalThis.fetch = async () => mockFetchResponse(ssePayload);

    const provider = createOpenAIProvider("test-key");
    const result = await provider.chat(baseChatParams);

    const toolBlocks = result.content.filter((b) => b.type === "tool_use");
    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]!.name).toBe("bash");
    expect(toolBlocks[0]!.input).toEqual({ command: "ls" });
    expect(toolBlocks[1]!.name).toBe("read_file");
    expect(toolBlocks[1]!.input).toEqual({ path: "a.ts" });
  });
});

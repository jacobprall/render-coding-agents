import { describe, it, expect } from "bun:test";
import { agentLoop } from "../src/loop";
import type { LLMProvider, LLMMessage, LLMResponse, ContentBlock, ToolDefinition } from "../src/llm";
import type { AgentTool } from "../src/loop";

function createMockProvider(responses: LLMResponse[]): LLMProvider {
  let callIdx = 0;
  return {
    chat: async () => {
      if (callIdx >= responses.length) {
        return responses[responses.length - 1];
      }
      return responses[callIdx++];
    },
  } as LLMProvider;
}

function textResponse(text: string): LLMResponse {
  return {
    content: [{ type: "text", text }],
    model: "test-model",
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

function toolUseResponse(toolName: string, input: unknown, id = "tc_1"): LLMResponse {
  return {
    content: [
      { type: "tool_use", id, name: toolName, input },
    ],
    model: "test-model",
    stopReason: "tool_use",
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

function emptyResponse(): LLMResponse {
  return {
    content: [{ type: "text", text: "" }],
    model: "test-model",
    stopReason: "end_turn",
    usage: { inputTokens: 10, outputTokens: 0 },
  };
}

describe("agentLoop", () => {
  describe("step limit enforcement", () => {
    it("stops at maxSteps and reports hitStepLimit", async () => {
      const provider = createMockProvider(
        Array(10).fill(toolUseResponse("echo", { text: "hi" })),
      );
      const tools = new Map<string, AgentTool>();
      tools.set("echo", {
        definition: { name: "echo", description: "echo", input_schema: { type: "object", properties: {} } },
        execute: async (input: unknown) => ({ result: (input as { text: string }).text }),
      });

      const result = await agentLoop({
        provider,
        model: "test",
        system: "test",
        messages: [{ role: "user", content: "do something" }],
        tools,
        maxSteps: 3,
      });

      expect(result.steps).toBe(3);
      expect(result.hitStepLimit).toBe(true);
      expect(result.terminationReason).toBe("step_limit");
    });

    it("does not report hitStepLimit when finishing early", async () => {
      const provider = createMockProvider([textResponse("done")]);
      const tools = new Map<string, AgentTool>();

      const result = await agentLoop({
        provider,
        model: "test",
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        tools,
        maxSteps: 10,
      });

      expect(result.steps).toBe(1);
      expect(result.hitStepLimit).toBe(false);
      expect(result.terminationReason).toBe("end_turn");
    });
  });

  describe("empty response retry", () => {
    it("retries empty responses up to MAX_EMPTY_RETRIES then stops", async () => {
      const provider = createMockProvider([
        emptyResponse(),
        emptyResponse(),
        emptyResponse(),
        emptyResponse(),
      ]);
      const tools = new Map<string, AgentTool>();

      const result = await agentLoop({
        provider,
        model: "test",
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        tools,
        maxSteps: 10,
      });

      expect(result.terminationReason).toBe("empty_response");
      // MAX_EMPTY_RETRIES=2: first empty retry (steps=1), second retry (steps=2), then gives up (steps=3)
      expect(result.steps).toBe(3);
    });

    it("succeeds if a non-empty response follows retries", async () => {
      const provider = createMockProvider([
        emptyResponse(),
        emptyResponse(),
        textResponse("finally something"),
      ]);
      const tools = new Map<string, AgentTool>();

      const result = await agentLoop({
        provider,
        model: "test",
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        tools,
        maxSteps: 10,
      });

      expect(result.terminationReason).toBe("end_turn");
      expect(result.text).toBe("finally something");
    });
  });

  describe("abort signal handling", () => {
    it("stops when abort signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const provider = createMockProvider([textResponse("should not reach")]);
      const tools = new Map<string, AgentTool>();

      const result = await agentLoop({
        provider,
        model: "test",
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        tools,
        maxSteps: 10,
        shouldAbort: async () => true,
      });

      expect(result.terminationReason).toBe("abort");
      expect(result.steps).toBe(0);
    });

    it("stops when shouldAbort returns true mid-execution", async () => {
      let callCount = 0;
      const provider = createMockProvider([
        toolUseResponse("echo", { text: "1" }, "tc_1"),
        toolUseResponse("echo", { text: "2" }, "tc_2"),
        textResponse("done"),
      ]);
      const tools = new Map<string, AgentTool>();
      tools.set("echo", {
        definition: { name: "echo", description: "echo", input_schema: { type: "object", properties: {} } },
        execute: async () => ({ ok: true }),
      });

      const result = await agentLoop({
        provider,
        model: "test",
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        tools,
        maxSteps: 10,
        shouldAbort: async () => {
          callCount++;
          return callCount > 1;
        },
      });

      expect(result.terminationReason).toBe("abort");
      expect(result.steps).toBeLessThan(3);
    });
  });

  describe("text accumulation", () => {
    it("accumulates text across multiple steps", async () => {
      const provider = createMockProvider([
        {
          content: [
            { type: "text", text: "Step 1. " },
            { type: "tool_use", id: "tc_1", name: "echo", input: {} },
          ],
          model: "test-model",
          stopReason: "tool_use",
          usage: { inputTokens: 10, outputTokens: 5 },
        } as LLMResponse,
        textResponse("Step 2."),
      ]);
      const tools = new Map<string, AgentTool>();
      tools.set("echo", {
        definition: { name: "echo", description: "echo", input_schema: { type: "object", properties: {} } },
        execute: async () => ({ ok: true }),
      });

      const result = await agentLoop({
        provider,
        model: "test",
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        tools,
        maxSteps: 10,
      });

      expect(result.text).toBe("Step 1. Step 2.");
      expect(result.steps).toBe(2);
    });
  });
});

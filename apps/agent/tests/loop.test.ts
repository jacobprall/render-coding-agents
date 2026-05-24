import { describe, it, expect, beforeAll } from "bun:test";
import type { LLMProvider, LLMMessage, LLMResponse, ContentBlock, ToolDefinition } from "../src/llm";
import type { AgentStep, AgentTool } from "../src/loop";

let agentLoop: typeof import("../src/loop").agentLoop;
let chatWithRetry: typeof import("../src/loop").chatWithRetry;
let isTransientLlmError: typeof import("../src/loop").isTransientLlmError;

beforeAll(async () => {
  const mod = await import("../src/loop");
  agentLoop = mod.agentLoop;
  chatWithRetry = mod.chatWithRetry;
  isTransientLlmError = mod.isTransientLlmError;
});

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

  describe("unknown tool handling", () => {
    it("returns error result for unknown tools", async () => {
      const provider = createMockProvider([
        toolUseResponse("missing_tool", { arg: "val" }),
        textResponse("done"),
      ]);
      const tools = new Map<string, AgentTool>();
      const steps: AgentStep[] = [];

      await agentLoop({
        provider,
        model: "test",
        system: "test",
        messages: [{ role: "user", content: "hi" }],
        tools,
        maxSteps: 10,
        onStep: async (step) => {
          steps.push(step);
        },
      });

      expect(steps).toHaveLength(2);
      expect(steps[0].toolCalls[0]).toMatchObject({
        toolName: "missing_tool",
        status: "error",
      });
      expect(steps[0].toolResults[0]).toEqual({
        toolCallId: "tc_1",
        output: { error: "Unknown tool: missing_tool" },
      });
    });
  });
});

describe("chatWithRetry", () => {
  const baseParams = {
    model: "test",
    system: "test",
    messages: [{ role: "user" as const, content: "hi" }],
    tools: [] as ToolDefinition[],
  };

  it("does not retry when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    let callCount = 0;
    const provider = {
      chat: async () => {
        callCount++;
        throw new DOMException("Turn timeout", "TimeoutError");
      },
    } as LLMProvider;

    await expect(
      chatWithRetry(provider, { ...baseParams, signal: controller.signal }),
    ).rejects.toThrow("Turn timeout");

    expect(callCount).toBe(1);
  });

  it("sleeps exactly twice before final failure on transient errors", async () => {
    const sleeps: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (typeof ms === "number") sleeps.push(ms);
      return originalSetTimeout(fn as () => void, 0);
    }) as typeof setTimeout;

    let callCount = 0;
    const provider = {
      chat: async () => {
        callCount++;
        throw new Error("503 service unavailable");
      },
    } as LLMProvider;

    try {
      await expect(chatWithRetry(provider, baseParams)).rejects.toThrow("503");
      expect(callCount).toBe(3);
      expect(sleeps).toEqual([1000, 4000]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});

describe("isTransientLlmError", () => {
  it("matches timeout errors", () => {
    expect(isTransientLlmError(new Error("network timeout"))).toBe(true);
    expect(isTransientLlmError(new DOMException("Turn timeout", "TimeoutError"))).toBe(true);
  });
});

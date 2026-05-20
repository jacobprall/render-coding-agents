import { describe, it, expect, mock } from "bun:test";
import { agentLoop } from "../../apps/agent/src/loop";
import type { LLMProvider, LLMResponse, ContentBlock } from "../../apps/agent/src/llm/types";
import type { AgentTool, AgentStep } from "../../apps/agent/src/loop";

function textResponse(text: string, usage = { inputTokens: 10, outputTokens: 5 }): LLMResponse {
  return {
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    usage,
    model: "test-model",
  };
}

function toolUseResponse(
  toolName: string,
  input: unknown,
  id = "call_1",
  usage = { inputTokens: 10, outputTokens: 5 },
): LLMResponse {
  return {
    content: [
      { type: "tool_use", id, name: toolName, input },
    ],
    stopReason: "tool_use",
    usage,
    model: "test-model",
  };
}

function mockProvider(responses: LLMResponse[]): LLMProvider {
  let callIndex = 0;
  return {
    async chat() {
      const resp = responses[callIndex];
      if (!resp) throw new Error(`No mock response at index ${callIndex}`);
      callIndex++;
      return resp;
    },
  };
}

function echoTool(): AgentTool {
  return {
    definition: { name: "echo", description: "echoes input", input_schema: { type: "object" } },
    execute: async (input) => ({ echoed: input }),
  };
}

describe("agentLoop", () => {
  it("returns text on a single end_turn response", async () => {
    const provider = mockProvider([textResponse("Hello!")]);

    const result = await agentLoop({
      provider,
      model: "test",
      system: "You are a test agent",
      messages: [{ role: "user", content: "Hi" }],
      tools: new Map(),
      maxSteps: 5,
    });

    expect(result.text).toBe("Hello!");
    expect(result.steps).toBe(1);
    expect(result.hitStepLimit).toBe(false);
    expect(result.totalUsage.inputTokens).toBe(10);
    expect(result.totalUsage.outputTokens).toBe(5);
  });

  it("dispatches tool calls and loops back to the provider", async () => {
    const provider = mockProvider([
      toolUseResponse("echo", { msg: "ping" }, "call_1"),
      textResponse("Done!"),
    ]);

    const tools = new Map<string, AgentTool>([["echo", echoTool()]]);

    const result = await agentLoop({
      provider,
      model: "test",
      system: "sys",
      messages: [{ role: "user", content: "Go" }],
      tools,
      maxSteps: 5,
    });

    expect(result.text).toBe("Done!");
    expect(result.steps).toBe(2);
    expect(result.hitStepLimit).toBe(false);
  });

  it("stops at maxSteps and sets hitStepLimit", async () => {
    const infiniteToolCalls = Array.from({ length: 10 }, (_, i) =>
      toolUseResponse("echo", { i }, `call_${i}`),
    );
    const provider = mockProvider(infiniteToolCalls);
    const tools = new Map<string, AgentTool>([["echo", echoTool()]]);

    const result = await agentLoop({
      provider,
      model: "test",
      system: "sys",
      messages: [{ role: "user", content: "Go" }],
      tools,
      maxSteps: 3,
    });

    expect(result.steps).toBe(3);
    expect(result.hitStepLimit).toBe(true);
  });

  it("aborts early when shouldAbort returns true", async () => {
    let abortAfter = 1;
    let callCount = 0;

    const provider = mockProvider([
      toolUseResponse("echo", {}, "c1"),
      toolUseResponse("echo", {}, "c2"),
      textResponse("never reached"),
    ]);
    const tools = new Map<string, AgentTool>([["echo", echoTool()]]);

    const result = await agentLoop({
      provider,
      model: "test",
      system: "sys",
      messages: [{ role: "user", content: "Go" }],
      tools,
      maxSteps: 10,
      shouldAbort: async () => {
        callCount++;
        return callCount > abortAfter;
      },
    });

    expect(result.steps).toBeLessThan(3);
  });

  it("fires onStep callback for each step", async () => {
    const provider = mockProvider([
      toolUseResponse("echo", { x: 1 }, "c1"),
      textResponse("fin"),
    ]);
    const tools = new Map<string, AgentTool>([["echo", echoTool()]]);

    const steps: AgentStep[] = [];
    await agentLoop({
      provider,
      model: "test",
      system: "sys",
      messages: [{ role: "user", content: "Go" }],
      tools,
      maxSteps: 5,
      onStep: async (step) => { steps.push(step); },
    });

    expect(steps).toHaveLength(2);
    expect(steps[0]!.toolCalls).toHaveLength(1);
    expect(steps[0]!.toolCalls[0]!.toolName).toBe("echo");
    expect(steps[1]!.toolCalls).toHaveLength(0);
  });

  it("handles unknown tool names gracefully", async () => {
    const provider = mockProvider([
      toolUseResponse("nonexistent", {}, "c1"),
      textResponse("recovered"),
    ]);

    const result = await agentLoop({
      provider,
      model: "test",
      system: "sys",
      messages: [{ role: "user", content: "Go" }],
      tools: new Map(),
      maxSteps: 5,
    });

    expect(result.text).toBe("recovered");
    expect(result.steps).toBe(2);

    const toolResultMsg = result.messages.find(
      (m) => m.role === "user" && Array.isArray(m.content),
    );
    expect(toolResultMsg).toBeTruthy();
    const block = (toolResultMsg!.content as ContentBlock[])[0]!;
    expect(block.is_error).toBe(true);
  });

  it("handles tool execution errors without crashing", async () => {
    const failingTool: AgentTool = {
      definition: { name: "fail", description: "always fails", input_schema: { type: "object" } },
      execute: async () => { throw new Error("kaboom"); },
    };

    const provider = mockProvider([
      toolUseResponse("fail", {}, "c1"),
      textResponse("recovered"),
    ]);
    const tools = new Map<string, AgentTool>([["fail", failingTool]]);

    const result = await agentLoop({
      provider,
      model: "test",
      system: "sys",
      messages: [{ role: "user", content: "Go" }],
      tools,
      maxSteps: 5,
    });

    expect(result.text).toBe("recovered");
    const toolResultMsg = result.messages.find(
      (m) => m.role === "user" && Array.isArray(m.content),
    );
    const block = (toolResultMsg!.content as ContentBlock[])[0]!;
    expect(block.is_error).toBe(true);
    expect(block.content).toContain("kaboom");
  });

  it("accumulates usage across multiple steps", async () => {
    const provider = mockProvider([
      toolUseResponse("echo", {}, "c1", { inputTokens: 100, outputTokens: 50 }),
      textResponse("done", { inputTokens: 200, outputTokens: 80 }),
    ]);
    const tools = new Map<string, AgentTool>([["echo", echoTool()]]);

    const result = await agentLoop({
      provider,
      model: "test",
      system: "sys",
      messages: [{ role: "user", content: "Go" }],
      tools,
      maxSteps: 5,
    });

    expect(result.totalUsage.inputTokens).toBe(300);
    expect(result.totalUsage.outputTokens).toBe(130);
  });

  it("only returns messages created during the loop (not initial messages)", async () => {
    const initialMessages = [
      { role: "user" as const, content: "Hello" },
    ];
    const provider = mockProvider([textResponse("Reply")]);

    const result = await agentLoop({
      provider,
      model: "test",
      system: "sys",
      messages: initialMessages,
      tools: new Map(),
      maxSteps: 5,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe("assistant");
  });
});

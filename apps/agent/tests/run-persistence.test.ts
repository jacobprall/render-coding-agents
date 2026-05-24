import { describe, it, expect, mock, beforeAll } from "bun:test";

mock.module("@coding-agents/db", () => ({
  agentRuns: {},
  chats: {},
  chatMessages: {},
  sessions: {},
}));

mock.module("@coding-agents/platform", () => ({}));
mock.module("ioredis", () => ({ default: class MockRedis {} }));

let mergeToolResults: typeof import("../src/run-persistence").mergeToolResults;
type AssistantPart = import("../src/types").AssistantPart;

beforeAll(async () => {
  const mod = await import("../src/run-persistence");
  mergeToolResults = mod.mergeToolResults;
});

describe("mergeToolResults", () => {
  it("merges matched tool_call and tool_result", () => {
    const parts: AssistantPart[] = [
      { type: "tool_call", toolCallId: "call-1", name: "bash", args: { command: "ls" } },
      { type: "tool_result", toolCallId: "call-1", result: "file.txt" },
    ];

    const merged = mergeToolResults(parts);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      type: "tool_call",
      toolCallId: "call-1",
      name: "bash",
      result: "file.txt",
    });
  });

  it("appends unmatched tool_result instead of dropping it", () => {
    const parts: AssistantPart[] = [
      { type: "tool_result", toolCallId: "orphan-1", result: "no matching call" },
    ];

    const merged = mergeToolResults(parts);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      type: "tool_result",
      toolCallId: "orphan-1",
      result: "no matching call",
    });
  });

  it("passes text parts through unchanged", () => {
    const parts: AssistantPart[] = [
      { type: "text", text: "Hello" },
      { type: "text", text: "World" },
    ];

    const merged = mergeToolResults(parts);
    expect(merged).toEqual(parts);
  });

  it("handles tool_result before tool_call", () => {
    const parts: AssistantPart[] = [
      { type: "tool_result", toolCallId: "call-early", result: "early result" },
      { type: "tool_call", toolCallId: "call-early", name: "read_file", args: { path: "/tmp/x" } },
    ];

    const merged = mergeToolResults(parts);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      type: "tool_result",
      toolCallId: "call-early",
      result: "early result",
    });
    expect(merged[1]).toMatchObject({
      type: "tool_call",
      toolCallId: "call-early",
      name: "read_file",
    });
    expect(merged[1].result).toBeUndefined();
  });

  it("merges result into the latest tool_call for duplicate toolCallId", () => {
    const parts: AssistantPart[] = [
      { type: "tool_call", toolCallId: "dup-1", name: "bash", args: { command: "first" } },
      { type: "tool_call", toolCallId: "dup-1", name: "bash", args: { command: "second" } },
      { type: "tool_result", toolCallId: "dup-1", result: "second output" },
    ];

    const merged = mergeToolResults(parts);
    expect(merged).toHaveLength(2);
    expect(merged[0].result).toBeUndefined();
    expect(merged[1]).toMatchObject({
      type: "tool_call",
      toolCallId: "dup-1",
      args: { command: "second" },
      result: "second output",
    });
  });
});

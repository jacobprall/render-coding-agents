import { describe, it, expect, beforeAll } from "bun:test";

let getToolResultTool: typeof import("../src/tools/get-tool-result").getToolResultTool;

beforeAll(async () => {
  const getToolResult = await import("../src/tools/get-tool-result");
  getToolResultTool = getToolResult.getToolResultTool;
});

describe("getToolResultTool", () => {
  it("returns { success: true, content: ... } for stored results", async () => {
    const resultStore = new Map<string, string>([["call-123", "stored output"]]);
    const tool = getToolResultTool(resultStore);
    const result = await tool.execute({ tool_call_id: "call-123" }, { context: null });

    expect(result).toEqual({ success: true, content: "stored output" });
  });

  it("returns { success: false, error: ... } for missing results", async () => {
    const resultStore = new Map<string, string>();
    const tool = getToolResultTool(resultStore);
    const result = await tool.execute({ tool_call_id: "missing-id" }, { context: null });

    expect(result).toEqual({
      success: false,
      error: 'No stored result for tool_call_id "missing-id".',
    });
  });
});

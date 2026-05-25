import { describe, it, expect, mock, beforeAll } from "bun:test";
import { z } from "zod";
import type Redis from "ioredis";
import type { LLMProvider } from "../src/llm";
import type { ForgeAgentContext } from "../src/context/agent-context";
import type { AgentJob } from "../src/types";

mock.module("../src/tools/ask-user", () => ({
  askUserQuestionTool: () => ({
    description: "Ask the user a question",
    inputSchema: z.object({ question: z.string() }),
    execute: async () => ({ success: true }),
  }),
}));

let buildToolSet: typeof import("../src/tool-registry").buildToolSet;
let buildSubagentToolConfigs: typeof import("../src/tool-registry").buildSubagentToolConfigs;

beforeAll(async () => {
  const registry = await import("../src/tool-registry");
  buildToolSet = registry.buildToolSet;
  buildSubagentToolConfigs = registry.buildSubagentToolConfigs;
});

const CORE_TOOL_NAMES = [
  "bash",
  "read_file",
  "write_file",
  "edit",
  "glob",
  "grep",
  "web_fetch",
] as const;

const REPO_TOOL_NAMES = ["git", "create_pull_request"] as const;

function createMinimalJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    runId: "run-1",
    chatId: "chat-1",
    sessionId: "sess-1",
    userId: "user-1",
    messages: [],
    resolvedSkills: [],
    ...overrides,
  };
}

function createBuildToolSetOptions(overrides: {
  hasRepo?: boolean;
  resultStore?: Map<string, string>;
} = {}) {
  return {
    events: {} as import("@coding-agents/platform").EventBus,
    redis: { duplicate: () => ({}) } as unknown as Redis,
    db: {} as import("@coding-agents/platform").PlatformDb,
    job: createMinimalJob(),
    provider: {} as LLMProvider,
    modelId: "anthropic/claude-sonnet-4-20250514",
    forgeContext: {} as ForgeAgentContext,
    hasRepo: overrides.hasRepo ?? true,
    resultStore: overrides.resultStore,
  };
}

describe("buildSubagentToolConfigs", () => {
  it("returns core tools without repo tools when hasRepo=false", () => {
    const configs = buildSubagentToolConfigs(false);

    for (const name of CORE_TOOL_NAMES) {
      expect(configs[name]).toBeDefined();
    }
    for (const name of REPO_TOOL_NAMES) {
      expect(configs[name]).toBeUndefined();
    }
  });

  it("returns core and repo tools when hasRepo=true", () => {
    const configs = buildSubagentToolConfigs(true);

    for (const name of [...CORE_TOOL_NAMES, ...REPO_TOOL_NAMES]) {
      expect(configs[name]).toBeDefined();
    }
  });
});

describe("buildToolSet", () => {
  it("returns a Map with expected tool names when called with options object", () => {
    const tools = buildToolSet(createBuildToolSetOptions({ hasRepo: true }));

    expect(tools).toBeInstanceOf(Map);
    for (const name of [...CORE_TOOL_NAMES, ...REPO_TOOL_NAMES, "get_tool_result", "task"]) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it("includes attach_repo but not git when hasRepo=false", () => {
    const tools = buildToolSet(createBuildToolSetOptions({ hasRepo: false }));

    expect(tools.has("attach_repo")).toBe(true);
    expect(tools.has("git")).toBe(false);
    expect(tools.has("create_pull_request")).toBe(false);
  });
});

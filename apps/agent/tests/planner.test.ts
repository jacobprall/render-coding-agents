import { describe, it, expect, beforeAll } from "bun:test";

let parsePlanOutput: typeof import("../src/planner").parsePlanOutput;
let formatPlanForContext: typeof import("../src/planner").formatPlanForContext;
let buildReadOnlyToolConfigs: typeof import("../src/planner").buildReadOnlyToolConfigs;
type PlanResult = import("../src/planner").PlanResult;

beforeAll(async () => {
  const mod = await import("../src/planner");
  parsePlanOutput = mod.parsePlanOutput;
  formatPlanForContext = mod.formatPlanForContext;
  buildReadOnlyToolConfigs = mod.buildReadOnlyToolConfigs;
});

describe("parsePlanOutput", () => {
  it("extracts plan, reasoning, and steps from markdown", () => {
    const text = `## Plan
Add user authentication with OAuth.

## Reasoning
OAuth is already partially integrated; extending it avoids new dependencies.

## Steps
1. Add OAuth callback route
2. Wire session middleware
3. Add login button to header`;

    const result = parsePlanOutput(text);

    expect(result.plan).toBe("Add user authentication with OAuth.");
    expect(result.reasoning).toBe(
      "OAuth is already partially integrated; extending it avoids new dependencies.",
    );
    expect(result.suggestedSteps).toEqual([
      "Add OAuth callback route",
      "Wire session middleware",
      "Add login button to header",
    ]);
  });

  it("falls back to full text when sections are missing", () => {
    const text = "Just a plain plan without markdown sections.";
    const result = parsePlanOutput(text);

    expect(result.plan).toBe(text);
    expect(result.reasoning).toBe("");
    expect(result.suggestedSteps).toEqual([]);
  });
});

describe("formatPlanForContext", () => {
  it("produces formatted output with plan, reasoning, and numbered steps", () => {
    const result: PlanResult = {
      plan: "Implement caching layer",
      reasoning: "Reduces database load",
      suggestedSteps: ["Add Redis client", "Cache hot queries"],
      formattedForContext: "",
    };

    const formatted = formatPlanForContext(result);

    expect(formatted).toContain("# Approved Implementation Plan");
    expect(formatted).toContain("## Plan");
    expect(formatted).toContain("Implement caching layer");
    expect(formatted).toContain("## Reasoning");
    expect(formatted).toContain("Reduces database load");
    expect(formatted).toContain("## Steps");
    expect(formatted).toContain("1. Add Redis client");
    expect(formatted).toContain("2. Cache hot queries");
    expect(formatted).toContain(
      "Follow this plan. If you discover issues during implementation",
    );
  });
});

describe("buildReadOnlyToolConfigs", () => {
  it("does not include git", () => {
    const configs = buildReadOnlyToolConfigs();
    expect(configs).not.toHaveProperty("git");
  });

  it("only contains read_file, glob, and grep", () => {
    const configs = buildReadOnlyToolConfigs();
    expect(Object.keys(configs).sort()).toEqual(["glob", "grep", "read_file"]);
  });
});

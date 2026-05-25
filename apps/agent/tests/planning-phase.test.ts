import { describe, it, expect, mock } from "bun:test";
import { formatPlanForContext } from "../src/planner";

describe("formatPlanForContext", () => {
  it("produces markdown suitable for system prompt injection", () => {
    const block = formatPlanForContext({
      plan: "Add feature X",
      reasoning: "Minimal diff",
      suggestedSteps: ["Edit foo.ts", "Add test"],
      formattedForContext: "",
    });

    expect(block).toContain("# Approved Implementation Plan");
    expect(block).toContain("Add feature X");
    expect(block).toContain("1. Edit foo.ts");
    expect(block).toContain("Follow this plan");
  });
});

describe("runPlanningPhaseIfNeeded", () => {
  it("skips when planning is disabled", async () => {
    const { runPlanningPhaseIfNeeded } = await import("../src/lib/planning-phase");
    const result = await runPlanningPhaseIfNeeded({
      job: {
        runId: "r1",
        chatId: "c1",
        sessionId: "s1",
        userId: "u1",
        messages: [{ role: "user", content: "hi" }],
        resolvedSkills: [],
        requestId: "req",
      },
      redis: {} as never,
      events: {} as never,
      db: {} as never,
      adapter: {} as never,
      enabled: false,
      isContinuation: false,
    });
    expect(result.status).toBe("skipped");
  });
});

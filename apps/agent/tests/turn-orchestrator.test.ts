import { describe, it, expect, mock, spyOn, beforeAll, afterEach } from "bun:test";
import type { AgentJob, AssistantPart } from "../src/types";
import type { ForgeAgentContext } from "../src/context/agent-context";

let isTimeoutAbort: typeof import("../src/turn-orchestrator").isTimeoutAbort;
let AbortError: typeof import("../src/turn-orchestrator").AbortError;
let createMergedAbortController: typeof import("../src/turn-orchestrator").createMergedAbortController;
let buildModelMessages: typeof import("../src/turn-orchestrator").buildModelMessages;
let buildWorkspaceContext: typeof import("../src/turn-orchestrator").buildWorkspaceContext;
let computeFileStatsFromParts: typeof import("../src/turn-orchestrator").computeFileStatsFromParts;
let runAgentTurn: typeof import("../src/turn-orchestrator").runAgentTurn;

function makeJob(overrides: Partial<AgentJob> = {}): AgentJob {
  return {
    runId: "run-1",
    chatId: "chat-1",
    sessionId: "sess-1",
    userId: "user-1",
    messages: [{ role: "user", content: "hello" }],
    resolvedSkills: [],
    requestId: "req-1",
    ...overrides,
  };
}

function makeForgeContext(overrides: Partial<ForgeAgentContext> = {}): ForgeAgentContext {
  return {
    __brand: "ForgeAgentContext",
    sessionId: "sess-1",
    projectId: null,
    forge: {} as ForgeAgentContext["forge"],
    repoOwner: "acme",
    repoName: "app",
    branch: "agent/sess-1",
    baseBranch: "main",
    adapter: {} as ForgeAgentContext["adapter"],
    ...overrides,
  };
}

function createMockDb(options: {
  claimReturns?: { id: string }[];
  existingStatus?: string;
}) {
  const claimReturns = options.claimReturns ?? [{ id: "run-1" }];
  return {
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve(claimReturns)),
        })),
      })),
    })),
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() =>
            Promise.resolve(
              options.existingStatus !== undefined
                ? [{ status: options.existingStatus, repoPath: "acme/app", branch: "main", baseBranch: "main", title: "Test", forgeType: "github", userId: "user-1", projectId: null }]
                : [{ status: "running", prNumber: null, prStatus: null }],
            ),
          ),
        })),
      })),
    })),
    insert: mock(() => Promise.resolve()),
  };
}

beforeAll(async () => {
  const mod = await import("../src/turn-orchestrator");
  isTimeoutAbort = mod.isTimeoutAbort;
  AbortError = mod.AbortError;
  createMergedAbortController = mod.createMergedAbortController;
  buildModelMessages = mod.buildModelMessages;
  buildWorkspaceContext = mod.buildWorkspaceContext;
  computeFileStatsFromParts = mod.computeFileStatsFromParts;
  runAgentTurn = mod.runAgentTurn;
});

describe("isTimeoutAbort", () => {
  it("returns true for native DOMException AbortError", () => {
    expect(isTimeoutAbort(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("returns true for Error named AbortError that is not custom AbortError", () => {
    const err = new Error("timeout");
    err.name = "AbortError";
    expect(isTimeoutAbort(err)).toBe(true);
  });

  it("returns false for custom AbortError with parts", () => {
    expect(isTimeoutAbort(new AbortError([]))).toBe(false);
  });

  it("returns false for generic errors", () => {
    expect(isTimeoutAbort(new Error("boom"))).toBe(false);
    expect(isTimeoutAbort("string")).toBe(false);
    expect(isTimeoutAbort(null)).toBe(false);
  });
});

describe("createMergedAbortController", () => {
  it("fires timeout abort after timeoutMs", async () => {
    const events = {
      getKey: async () => null,
    };
    const { controller, cleanup } = createMergedAbortController(
      events as never,
      "run-1",
      50,
    );

    await new Promise((r) => setTimeout(r, 80));
    expect(controller.signal.aborted).toBe(true);
    cleanup();
  });

  it("cleanup clears timers so poll does not keep running", async () => {
    let calls = 0;
    const events = {
      getKey: async () => {
        calls += 1;
        return null;
      },
    };
    const { controller, cleanup } = createMergedAbortController(
      events as never,
      "run-1",
      60_000,
    );

    cleanup();
    await new Promise((r) => setTimeout(r, 600));
    expect(calls).toBeLessThanOrEqual(1);
    expect(controller.signal.aborted).toBe(false);
  });

  it("aborts on user stop signal from events", async () => {
    let calls = 0;
    const events = {
      getKey: async () => {
        calls += 1;
        return calls >= 2 ? "1" : null;
      },
    };
    const { controller, cleanup } = createMergedAbortController(
      events as never,
      "run-1",
      60_000,
    );

    await new Promise((r) => setTimeout(r, 1200));
    expect(controller.signal.aborted).toBe(true);
    cleanup();
  });
});

describe("buildModelMessages", () => {
  it("uses modelMessages when present", () => {
    const job = makeJob({
      modelMessages: [{ role: "user", content: "from model messages" }],
      messages: [{ role: "user", content: "fallback" }],
    });
    const result = buildModelMessages(job);
    expect(result).toEqual([{ role: "user", content: "from model messages" }]);
  });

  it("falls back to job messages when modelMessages is empty", () => {
    const job = makeJob({
      modelMessages: [],
      messages: [{ role: "user", content: "hello there" }],
    });
    const result = buildModelMessages(job);
    expect(result).toEqual([{ role: "user", content: "hello there" }]);
  });

  it("filters empty messages via sanitize", () => {
    const job = makeJob({
      modelMessages: [
        { role: "user", content: "   " },
        { role: "user", content: "keep me" },
      ],
    });
    const result = buildModelMessages(job);
    expect(result).toEqual([{ role: "user", content: "keep me" }]);
  });
});

describe("buildWorkspaceContext", () => {
  it("returns null when session row is missing", () => {
    expect(buildWorkspaceContext(undefined, makeForgeContext())).toBeNull();
  });

  it("describes scratch mode when no repo is attached", () => {
    const ctx = makeForgeContext();
    const result = buildWorkspaceContext(
      { repoPath: null, branch: null, baseBranch: null, userId: "user-1" },
      ctx,
    );
    expect(result).toContain("Scratch workbench");
    expect(result).toContain("/workspace/scratch/user-1");
  });

  it("describes single-repo workspace", () => {
    const result = buildWorkspaceContext(
      {
        repoPath: "acme/app",
        branch: "agent/sess-1",
        baseBranch: "main",
      },
      makeForgeContext({ repoOwner: "acme", repoName: "app" }),
    );
    expect(result).toContain("acme/app");
    expect(result).toContain("/workspace/sess-1");
    expect(result).toContain("Branch:** agent/sess-1");
  });

  it("describes multi-repo workspace", () => {
    const result = buildWorkspaceContext(
      {
        repoPath: "acme/primary",
        branch: "agent/sess-1",
        baseBranch: "main",
      },
      makeForgeContext(),
      {
        workdir: "/workspace/sess-1/repos/primary",
        repos: [
          { repoPath: "acme/primary", forgeType: "github", defaultBranch: "main", isPrimary: true },
          { repoPath: "acme/other", forgeType: "github", defaultBranch: "main", isPrimary: false },
        ],
      },
    );
    expect(result).toContain("Multi-repository workspace");
    expect(result).toContain("acme/primary");
    expect(result).toContain("acme/other");
    expect(result).toContain("(primary)");
  });
});

describe("computeFileStatsFromParts", () => {
  it("sums additions and deletions from file_changed parts", () => {
    const parts: AssistantPart[] = [
      { type: "text", text: "hi" },
      { type: "file_changed", path: "a.ts", additions: 10, deletions: 2 },
      { type: "file_changed", path: "b.ts", additions: 5, deletions: 1 },
    ];
    expect(computeFileStatsFromParts(parts)).toEqual({
      linesAdded: 15,
      linesRemoved: 3,
    });
  });

  it("returns zero when no file_changed parts exist", () => {
    expect(computeFileStatsFromParts([{ type: "text", text: "x" }])).toEqual({
      linesAdded: 0,
      linesRemoved: 0,
    });
  });
});

describe("runAgentTurn idempotency", () => {
  const spies: ReturnType<typeof spyOn>[] = [];

  afterEach(() => {
    for (const s of spies) s.mockRestore();
    spies.length = 0;
  });

  it("skips when atomic claim returns empty", async () => {
    const workspace = await import("../src/workspace");
    const providers = await import("../src/providers");
    const setupSpy = spyOn(workspace, "setupWorkspace");
    const adapterSpy = spyOn(providers, "getAdapter");
    spies.push(setupSpy, adapterSpy);

    const db = createMockDb({ claimReturns: [], existingStatus: "running" });
    const events = {
      setKey: mock(() => Promise.resolve()),
      getKey: mock(() => Promise.resolve(null)),
      consumeSteering: mock(() => Promise.resolve([])),
    };
    const platform = { db, events };

    await runAgentTurn(makeJob(), {} as never, platform as never);

    expect(setupSpy).not.toHaveBeenCalled();
    expect(adapterSpy).not.toHaveBeenCalled();
  });

  it("runs setup when claim succeeds", async () => {
    const workspace = await import("../src/workspace");
    const providers = await import("../src/providers");
    const agentLoopMod = await import("../src/loop");
    const observability = await import("../src/observability");
    const prManager = await import("../src/pr-manager");
    const models = await import("../src/models");

    spies.push(
      spyOn(workspace, "setupWorkspace").mockResolvedValue({
        workdir: "/workspace/sess-1",
        repoCount: 1,
      }),
      spyOn(workspace, "cleanupWorktrees").mockResolvedValue(undefined),
      spyOn(providers, "getAdapter").mockResolvedValue({} as never),
      spyOn(providers, "getForgeProviderForSession").mockResolvedValue({} as never),
      spyOn(models, "getModel").mockReturnValue({ provider: {} as never, modelId: "test-model" }),
      spyOn(models, "getModelDef").mockReturnValue({ provider: "openai", thinkingType: undefined } as never),
      spyOn(agentLoopMod, "agentLoop").mockResolvedValue({
        text: "done",
        messages: [],
        totalUsage: { inputTokens: 0, outputTokens: 0 },
        hitStepLimit: false,
        steps: 1,
      }),
      spyOn(observability.ObservabilityRecorder.prototype, "close").mockResolvedValue(undefined),
      spyOn(prManager, "createPrsForChangedRepos").mockResolvedValue({
        prUrls: [],
        reposTouched: [],
        linesAdded: 0,
        linesRemoved: 0,
      }),
      spyOn(prManager, "persistSessionSummary").mockResolvedValue(undefined),
    );

    const sessionRow = {
      status: "running",
      repoPath: "acme/app",
      branch: "main",
      baseBranch: "main",
      title: "Test",
      forgeType: "github",
      userId: "user-1",
      projectId: null,
      prNumber: null,
      prStatus: null,
    };
    const db = {
      update: mock(() => ({
        set: mock(() => ({
          where: mock(() => ({
            returning: mock(() => Promise.resolve([{ id: "run-1" }])),
          })),
        })),
      })),
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() =>
            Object.assign(Promise.resolve([]), {
              limit: mock(() => Promise.resolve([sessionRow])),
            }),
          ),
        })),
      })),
      insert: mock(() => Promise.resolve()),
    };
    const events = {
      setKey: mock(() => Promise.resolve()),
      getKey: mock(() => Promise.resolve(null)),
      publish: mock(() => Promise.resolve()),
      consumeSteering: mock(() => Promise.resolve([])),
    };
    const platformContainer = { db, events };

    const prevOpenAiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";

    try {
      await runAgentTurn(
        makeJob(),
        { expire: mock(() => Promise.resolve()) } as never,
        platformContainer as never,
      );
    } finally {
      if (prevOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = prevOpenAiKey;
      }
    }

    expect(workspace.setupWorkspace).toHaveBeenCalled();
    expect(workspace.cleanupWorktrees).toHaveBeenCalled();
  });
});

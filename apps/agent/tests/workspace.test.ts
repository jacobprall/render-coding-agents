import { describe, it, expect, mock } from "bun:test";
import { setupWorkspace } from "../src/workspace";

describe("setupWorkspace", () => {
  it("skips setup events when multi-repo worktrees already exist", async () => {
    const publishEvent = mock(() => Promise.resolve());
    const adapter = {
      exec: mock(() => Promise.resolve({ stdout: "ready", exitCode: 0 })),
      fetchMirror: mock(() => Promise.resolve({ status: "ready", durationMs: 1, newCommits: 0 })),
      writeFile: mock(() => Promise.resolve()),
      glob: mock(() => Promise.resolve({ files: ["repos/app"] })),
      ensureMirror: mock(() => Promise.resolve({ status: "ready", path: "", sizeBytes: 0, created: false })),
      createWorktree: mock(() => Promise.resolve({ path: "", branch: "", durationMs: 0 })),
    };

    // Use unique session IDs to avoid cross-test cache interference
    const sessionId = `sess-wt-${Date.now()}`;

    const result = await setupWorkspace({
      job: {
        runId: "run-1",
        sessionId,
        userId: "user-1",
        workspaceId: "ws-1",
        sessionContext: { branch: `agent/${sessionId}`, repoPath: null, baseBranch: "main", title: "test", forgeType: "github", projectId: null },
        repos: [{ repoPath: "acme/app", defaultBranch: "main", forgeType: "github", isPrimary: true }],
      } as never,
      db: {} as never,
      adapter: adapter as never,
      events: { publishEvent } as never,
    });

    expect(result.workdir).toBe(`/workspace/${sessionId}/repos/app`);
    expect(publishEvent).not.toHaveBeenCalled();
    expect(adapter.fetchMirror).toHaveBeenCalled();
    expect(adapter.ensureMirror).not.toHaveBeenCalled();
    expect(adapter.createWorktree).not.toHaveBeenCalled();
  });

  it("uses workspace-ready cache on second call", async () => {
    const publishEvent = mock(() => Promise.resolve());
    const execMock = mock(() => Promise.resolve({ stdout: "ready", exitCode: 0 }));
    const fetchMirrorMock = mock(() => Promise.resolve({ status: "ready", durationMs: 1, newCommits: 0 }));
    const adapter = {
      exec: execMock,
      fetchMirror: fetchMirrorMock,
      writeFile: mock(() => Promise.resolve()),
      glob: mock(() => Promise.resolve({ files: ["repos/svc"] })),
      ensureMirror: mock(() => Promise.resolve({ status: "ready", path: "", sizeBytes: 0, created: false })),
      createWorktree: mock(() => Promise.resolve({ path: "", branch: "", durationMs: 0 })),
    };

    const sessionId = `sess-cache-${Date.now()}`;
    const jobBase = {
      runId: "run-2",
      sessionId,
      userId: "user-1",
      workspaceId: "ws-2",
      sessionContext: { branch: `agent/${sessionId}`, repoPath: null, baseBranch: "main", title: "test", forgeType: "github", projectId: null },
      repos: [{ repoPath: "acme/svc", defaultBranch: "main", forgeType: "github", isPrimary: true }],
    } as never;

    // First call — hits sandbox
    await setupWorkspace({ job: jobBase, db: {} as never, adapter: adapter as never, events: { publishEvent } as never });
    const firstExecCount = execMock.mock.calls.length;
    expect(firstExecCount).toBeGreaterThan(0);

    // Second call — should skip sandbox entirely (cached)
    await setupWorkspace({ job: jobBase, db: {} as never, adapter: adapter as never, events: { publishEvent } as never });
    expect(execMock.mock.calls.length).toBe(firstExecCount);
  });
});

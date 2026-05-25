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

    const db = {
      select: mock(() => ({
        from: mock(() => ({
          where: mock(() => ({
            limit: mock(() => Promise.resolve([{ branch: "agent/sess-1" }])),
          })),
        })),
      })),
    };

    const result = await setupWorkspace({
      job: {
        runId: "run-1",
        sessionId: "sess-1",
        userId: "user-1",
        workspaceId: "ws-1",
        repos: [{ repoPath: "acme/app", defaultBranch: "main", forgeType: "github", isPrimary: true }],
      } as never,
      db: db as never,
      adapter: adapter as never,
      events: { publishEvent } as never,
    });

    expect(result.workdir).toBe("/workspace/sess-1/repos/app");
    expect(publishEvent).not.toHaveBeenCalled();
    expect(adapter.fetchMirror).toHaveBeenCalled();
    expect(adapter.ensureMirror).not.toHaveBeenCalled();
    expect(adapter.createWorktree).not.toHaveBeenCalled();
  });
});

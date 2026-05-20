/**
 * End-to-end MCP tests for the full platform surface.
 *
 * Uses the official MCP SDK client connected to the server via an in-memory
 * transport pair. Every registered tool is exercised to confirm it is
 * callable via the MCP protocol and returns valid results.
 */
import { describe, test, expect, mock, beforeAll, afterAll } from "bun:test";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

// ---------------------------------------------------------------------------
// In-memory transport pair
// ---------------------------------------------------------------------------

function createLinkedTransportPair(): [Transport, Transport] {
  let aOnMessage: Transport["onmessage"];
  let bOnMessage: Transport["onmessage"];
  let aOnClose: Transport["onclose"];
  let bOnClose: Transport["onclose"];

  const a: Transport = {
    async start() {},
    async send(msg: JSONRPCMessage, _opts?: TransportSendOptions) {
      // a sends → b receives
      queueMicrotask(() => bOnMessage?.(msg));
    },
    async close() {
      aOnClose?.();
      bOnClose?.();
    },
    set onmessage(fn) { aOnMessage = fn; },
    get onmessage() { return aOnMessage; },
    set onclose(fn) { aOnClose = fn; },
    get onclose() { return aOnClose; },
  };

  const b: Transport = {
    async start() {},
    async send(msg: JSONRPCMessage, _opts?: TransportSendOptions) {
      // b sends → a receives
      queueMicrotask(() => aOnMessage?.(msg));
    },
    async close() {
      aOnClose?.();
      bOnClose?.();
    },
    set onmessage(fn) { bOnMessage = fn; },
    get onmessage() { return bOnMessage; },
    set onclose(fn) { bOnClose = fn; },
    get onclose() { return bOnClose; },
  };

  return [a, b];
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuth = {
  userId: "user-1",
  username: "testuser",
  forgeToken: "tok_test",
  forgeType: "github" as const,
  isAdmin: false,
};

const mockForgeProvider = {
  repos: {
    list: mock(async () => [{ name: "repo1", fullName: "org/repo1" }]),
    search: mock(async (q: string) => [{ name: q, fullName: `org/${q}` }]),
  },
  branches: {
    list: mock(async () => [{ name: "main" }, { name: "dev" }]),
  },
};

mock.module("@coding-agents/platform/forge", () => ({
  getForgeProviderForAuth: () => mockForgeProvider,
}));

const mockPlatform = {
  db: { execute: async () => [{ "?column?": 1 }] },

  sessions: {
    create: mock(async (_a: any, params: any) => ({ sessionId: "sess-1", ...params })),
    sendMessage: mock(async () => ({ messageId: "msg-1", runId: "run-1", isFirstMessage: false })),
    reply: mock(async () => {}),
    stop: mock(async () => ({ stopped: true })),
    archive: mock(async () => {}),
    updatePhase: mock(async () => {}),
    updateConfig: mock(async () => ({ updated: true })),
    getSkills: mock(async () => [{ source: "builtin", slug: "default" }]),
    updateSkills: mock(async () => {}),
    handleSpecAction: mock(async () => ({ ok: true })),
    generateAutoTitle: mock(async () => ({ title: "Auto Title" })),
    listCiEvents: mock(async () => [{ id: "ci-1", status: "success" }]),
    enqueueReviewJob: mock(async () => ({ ok: true })),
  },

  repos: {
    importRepo: mock(async (_a: any, params: any) => ({
      repo: { name: params.repoName },
      deferredTasks: [],
    })),
    getFileContents: mock(async () => ({ content: "aGVsbG8=", encoding: "base64" })),
    putFileContents: mock(async () => ({ sha: "abc123" })),
    getAgentConfig: mock(async () => ({ model: "claude-4" })),
    writeAgentConfig: mock(async () => ({ sha: "def456" })),
    listBranchProtections: mock(async () => [{ pattern: "main" }]),
    getBranchProtection: mock(async () => ({ pattern: "main" })),
    setBranchProtection: mock(async () => ({ pattern: "main" })),
    deleteBranchProtection: mock(async () => {}),
    listSecrets: mock(async () => [{ name: "SECRET_1" }]),
    setSecret: mock(async () => {}),
    deleteSecret: mock(async () => {}),
    getTestResults: mock(async () => ({ passed: 10, failed: 0 })),
    listArtifacts: mock(async () => [{ id: "art-1", name: "build.zip" }]),
    downloadArtifact: mock(async () => new ArrayBuffer(0)),
    getJobLogs: mock(async () => "build succeeded"),
  },

  pullRequests: {
    createPullRequest: mock(async () => ({ number: 1, url: "http://pr/1" })),
    updatePullRequest: mock(async () => ({ number: 1, state: "closed" })),
    mergePullRequest: mock(async () => ({ merged: true })),
    listComments: mock(async () => [{ id: 1, body: "LGTM" }]),
    createComment: mock(async () => ({ id: 2, body: "New comment" })),
    resolveComment: mock(async () => ({ resolved: true })),
    listReviews: mock(async () => [{ id: 1, state: "approved" }]),
    submitReview: mock(async () => ({ id: 2, state: "approved" })),
  },

  orgs: {
    listOrgs: mock(async () => [{ login: "myorg" }]),
    createOrg: mock(async (_a: any, params: any) => ({ login: params.login })),
    deleteOrg: mock(async () => {}),
    listMembers: mock(async () => [{ username: "alice" }]),
    addMember: mock(async () => {}),
    removeMember: mock(async () => {}),
    listSecrets: mock(async () => [{ name: "ORG_SECRET" }]),
    setSecret: mock(async () => {}),
    deleteSecret: mock(async () => {}),
    getUsage: mock(async () => ({ tokens: 1000 })),
    getPlatformOrg: mock(async () => ({ name: "Platform Org" })),
    updatePlatformOrg: mock(async () => ({ name: "Updated Org" })),
    listPlatformMembers: mock(async () => [{ username: "admin" }]),
  },

  projects: {
    list: mock(async () => [{ id: "proj-1", name: "My Project" }]),
    create: mock(async (_a: any, params: any) => ({ id: "proj-2", ...params })),
    get: mock(async () => ({ id: "proj-1", name: "My Project" })),
    update: mock(async (_a: any, _id: any, params: any) => ({ id: "proj-1", ...params })),
    delete: mock(async () => {}),
    addRepo: mock(async () => ({ repoPath: "org/repo" })),
    removeRepo: mock(async () => {}),
    findOrCreateForRepo: mock(async () => ({ id: "proj-auto" })),
    getScratchProject: mock(async () => ({ id: "proj-scratch" })),
  },

  skills: {
    listSkills: mock(async () => [{ slug: "default", source: "builtin" }]),
    listRepoSkills: mock(async () => [{ slug: "repo-skill" }]),
    installSkill: mock(async () => ({ slug: "new-skill" })),
    syncSkills: mock(async () => {}),
  },

  inbox: {
    list: mock(async () => ({ items: [{ id: "evt-1" }], total: 1 })),
    countUnread: mock(async () => 3),
    dismiss: mock(async () => {}),
  },

  mirrors: {
    list: mock(async () => ({ mirrors: [{ id: "m-1" }], total: 1 })),
    create: mock(async (_a: any, params: any) => ({ id: "m-2", ...params })),
    sync: mock(async () => ({ synced: true })),
    delete: mock(async () => {}),
    resolveConflict: mock(async () => ({ resolved: true })),
  },

  models: {
    listModels: mock(async () => [{ id: "claude-4", name: "Claude 4" }]),
  },

  settings: {
    listApiKeys: mock(async () => [{ id: "key-1", provider: "anthropic" }]),
    createOrUpdateApiKey: mock(async (_a: any, params: any) => ({ id: "key-2", ...params })),
    updateApiKey: mock(async () => {}),
    deleteApiKey: mock(async () => {}),
  },

  notifications: {
    list: mock(async () => ({ items: [{ id: "n-1" }], total: 1 })),
  },

  invites: {
    listInvites: mock(async () => [{ id: "inv-1" }]),
    createInvite: mock(async (_a: any, params: any) => ({ id: "inv-2", ...params })),
  },
};

mock.module("../src/platform", () => ({
  getPlatform: () => mockPlatform,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createMcpServer } from "../src/mcp/server";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let client: Client;

beforeAll(async () => {
  const mcpServer = createMcpServer(mockAuth);
  client = new Client({ name: "test-client", version: "1.0.0" });

  const [clientTransport, serverTransport] = createLinkedTransportPair();
  await mcpServer.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBeFalsy();
  const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP Server — end-to-end", () => {
  test("lists all registered tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names.length).toBeGreaterThanOrEqual(50);

    expect(names).toContain("create-session");
    expect(names).toContain("list-repos");
    expect(names).toContain("create-pull-request");
    expect(names).toContain("list-projects");
    expect(names).toContain("list-api-keys");
    expect(names).toContain("list-notifications");
    expect(names).toContain("create-invite");
    expect(names).toContain("create-mirror");
    expect(names).toContain("search-repos");
  });

  // ---- Session tools -------------------------------------------------------

  describe("Session tools", () => {
    test("create-session", async () => {
      const res = await callTool("create-session", {
        repoPath: "org/repo",
        branch: "main",
        title: "Test session",
      });
      expect(res.sessionId).toBe("sess-1");
    });

    test("send-message", async () => {
      const res = await callTool("send-message", {
        sessionId: "sess-1",
        content: "Hello agent",
      });
      expect(res.messageId).toBe("msg-1");
    });

    test("reply-to-agent", async () => {
      const res = await callTool("reply-to-agent", {
        sessionId: "sess-1",
        toolCallId: "tc-1",
        message: "Yes",
      });
      expect(res.ok).toBe(true);
    });

    test("stop-session", async () => {
      const res = await callTool("stop-session", { sessionId: "sess-1" });
      expect(res.stopped).toBe(true);
    });

    test("archive-session", async () => {
      const res = await callTool("archive-session", { sessionId: "sess-1" });
      expect(res.ok).toBe(true);
    });

    test("update-session-phase", async () => {
      const res = await callTool("update-session-phase", {
        sessionId: "sess-1",
        phase: "reviewing",
      });
      expect(res.ok).toBe(true);
    });

    test("update-session-config", async () => {
      const res = await callTool("update-session-config", {
        sessionId: "sess-1",
        config: { autoApprove: true },
      });
      expect(res.updated).toBe(true);
    });

    test("get-session-skills", async () => {
      const res = await callTool("get-session-skills", { sessionId: "sess-1" });
      expect(res).toBeArray();
      expect(res[0].slug).toBe("default");
    });

    test("update-session-skills", async () => {
      const res = await callTool("update-session-skills", {
        sessionId: "sess-1",
        skills: [{ source: "builtin", slug: "default" }],
      });
      expect(res.ok).toBe(true);
    });

    test("session-spec-action", async () => {
      const res = await callTool("session-spec-action", {
        sessionId: "sess-1",
        specId: "spec-1",
        action: "approve",
      });
      expect(res.ok).toBe(true);
    });

    test("auto-title-session", async () => {
      const res = await callTool("auto-title-session", { sessionId: "sess-1" });
      expect(res.title).toBe("Auto Title");
    });

    test("list-ci-events", async () => {
      const res = await callTool("list-ci-events", { sessionId: "sess-1" });
      expect(res).toBeArray();
      expect(res[0].status).toBe("success");
    });

    test("enqueue-review", async () => {
      const res = await callTool("enqueue-review", {
        sessionId: "sess-1",
        fixContext: "Fix failing tests",
      });
      expect(res.ok).toBe(true);
    });
  });

  // ---- Repo tools -----------------------------------------------------------

  describe("Repo tools", () => {
    test("list-repos", async () => {
      const res = await callTool("list-repos");
      expect(res).toBeArray();
      expect(res[0].name).toBe("repo1");
    });

    test("search-repos", async () => {
      const res = await callTool("search-repos", { query: "myrepo" });
      expect(res).toBeArray();
      expect(res[0].name).toBe("myrepo");
    });

    test("list-branches", async () => {
      const res = await callTool("list-branches", { owner: "org", repo: "repo1" });
      expect(res).toBeArray();
      expect(res[0].name).toBe("main");
    });

    test("import-repo", async () => {
      const res = await callTool("import-repo", {
        cloneAddr: "https://github.com/test/repo.git",
        repoName: "imported",
      });
      expect(res.name).toBe("imported");
    });

    test("get-file-contents", async () => {
      const res = await callTool("get-file-contents", {
        owner: "org", repo: "repo1", filePath: "README.md",
      });
      expect(res.content).toBe("aGVsbG8=");
    });

    test("put-file-contents", async () => {
      const res = await callTool("put-file-contents", {
        owner: "org", repo: "repo1", filePath: "test.txt",
        content: "dGVzdA==", message: "add test file",
      });
      expect(res.sha).toBe("abc123");
    });

    test("get-agent-config", async () => {
      const res = await callTool("get-agent-config", { owner: "org", repo: "repo1" });
      expect(res.model).toBe("claude-4");
    });

    test("write-agent-config", async () => {
      const res = await callTool("write-agent-config", {
        owner: "org", repo: "repo1", content: '{"model":"claude-4"}',
      });
      expect(res.sha).toBe("def456");
    });

    test("list-branch-protections", async () => {
      const res = await callTool("list-branch-protections", { owner: "org", repo: "repo1" });
      expect(res).toBeArray();
      expect(res[0].pattern).toBe("main");
    });

    test("get-branch-protection", async () => {
      const res = await callTool("get-branch-protection", {
        owner: "org", repo: "repo1", branch: "main",
      });
      expect(res.pattern).toBe("main");
    });

    test("set-branch-protection", async () => {
      const res = await callTool("set-branch-protection", {
        owner: "org", repo: "repo1", pattern: "main",
      });
      expect(res.pattern).toBe("main");
    });

    test("delete-branch-protection", async () => {
      const res = await callTool("delete-branch-protection", {
        owner: "org", repo: "repo1", branch: "main",
      });
      expect(res.ok).toBe(true);
    });

    test("list-repo-secrets", async () => {
      const res = await callTool("list-repo-secrets", { owner: "org", repo: "repo1" });
      expect(res).toBeArray();
      expect(res[0].name).toBe("SECRET_1");
    });

    test("set-repo-secret", async () => {
      const res = await callTool("set-repo-secret", {
        owner: "org", repo: "repo1", name: "NEW_SECRET", value: "s3cret",
      });
      expect(res.ok).toBe(true);
    });

    test("delete-repo-secret", async () => {
      const res = await callTool("delete-repo-secret", {
        owner: "org", repo: "repo1", name: "SECRET_1",
      });
      expect(res.ok).toBe(true);
    });

    test("get-test-results", async () => {
      const res = await callTool("get-test-results", {
        owner: "org", repo: "repo1", runId: "run-1",
      });
      expect(res.passed).toBe(10);
    });

    test("list-artifacts", async () => {
      const res = await callTool("list-artifacts", {
        owner: "org", repo: "repo1", runId: "run-1",
      });
      expect(res).toBeArray();
      expect(res[0].name).toBe("build.zip");
    });

    test("get-job-logs", async () => {
      const res = await callTool("get-job-logs", {
        owner: "org", repo: "repo1", jobId: "job-1",
      });
      expect(res.logs).toBe("build succeeded");
    });
  });

  // ---- Pull Request tools ---------------------------------------------------

  describe("Pull Request tools", () => {
    test("create-pull-request", async () => {
      const res = await callTool("create-pull-request", {
        owner: "org", repo: "repo1", title: "New feature",
        head: "feature", base: "main",
      });
      expect(res.number).toBe(1);
    });

    test("update-pull-request", async () => {
      const res = await callTool("update-pull-request", {
        owner: "org", repo: "repo1", number: 1, state: "closed",
      });
      expect(res.state).toBe("closed");
    });

    test("merge-pull-request", async () => {
      const res = await callTool("merge-pull-request", {
        owner: "org", repo: "repo1", number: 1, method: "squash",
      });
      expect(res.merged).toBe(true);
    });

    test("list-pr-comments", async () => {
      const res = await callTool("list-pr-comments", {
        owner: "org", repo: "repo1", number: 1,
      });
      expect(res).toBeArray();
      expect(res[0].body).toBe("LGTM");
    });

    test("create-pr-comment", async () => {
      const res = await callTool("create-pr-comment", {
        owner: "org", repo: "repo1", number: 1, body: "Looks good",
      });
      expect(res.id).toBe(2);
    });

    test("resolve-pr-comment", async () => {
      const res = await callTool("resolve-pr-comment", {
        owner: "org", repo: "repo1", commentId: 1,
      });
      expect(res.resolved).toBe(true);
    });

    test("list-pr-reviews", async () => {
      const res = await callTool("list-pr-reviews", {
        owner: "org", repo: "repo1", number: 1,
      });
      expect(res).toBeArray();
      expect(res[0].state).toBe("approved");
    });

    test("submit-pr-review", async () => {
      const res = await callTool("submit-pr-review", {
        owner: "org", repo: "repo1", number: 1,
        event: "approve", body: "Ship it",
      });
      expect(res.state).toBe("approved");
    });
  });

  // ---- Org tools ------------------------------------------------------------

  describe("Org tools", () => {
    test("list-orgs", async () => {
      const res = await callTool("list-orgs");
      expect(res).toBeArray();
      expect(res[0].login).toBe("myorg");
    });

    test("create-org", async () => {
      const res = await callTool("create-org", { login: "neworg" });
      expect(res.login).toBe("neworg");
    });

    test("delete-org", async () => {
      const res = await callTool("delete-org", { orgName: "neworg" });
      expect(res.ok).toBe(true);
    });

    test("list-org-members", async () => {
      const res = await callTool("list-org-members", { orgName: "myorg" });
      expect(res).toBeArray();
      expect(res[0].username).toBe("alice");
    });

    test("add-org-member", async () => {
      const res = await callTool("add-org-member", { orgName: "myorg", username: "bob" });
      expect(res.ok).toBe(true);
    });

    test("remove-org-member", async () => {
      const res = await callTool("remove-org-member", { orgName: "myorg", username: "bob" });
      expect(res.ok).toBe(true);
    });

    test("list-org-secrets", async () => {
      const res = await callTool("list-org-secrets", { orgName: "myorg" });
      expect(res).toBeArray();
    });

    test("set-org-secret", async () => {
      const res = await callTool("set-org-secret", {
        orgName: "myorg", name: "SECRET", value: "val",
      });
      expect(res.ok).toBe(true);
    });

    test("delete-org-secret", async () => {
      const res = await callTool("delete-org-secret", { orgName: "myorg", name: "SECRET" });
      expect(res.ok).toBe(true);
    });

    test("get-usage", async () => {
      const res = await callTool("get-usage");
      expect(res.tokens).toBe(1000);
    });

    test("get-platform-org", async () => {
      const res = await callTool("get-platform-org");
      expect(res.name).toBe("Platform Org");
    });

    test("update-platform-org", async () => {
      const res = await callTool("update-platform-org", { name: "Updated Org" });
      expect(res.name).toBe("Updated Org");
    });

    test("list-platform-members", async () => {
      const res = await callTool("list-platform-members");
      expect(res).toBeArray();
      expect(res[0].username).toBe("admin");
    });
  });

  // ---- Project tools --------------------------------------------------------

  describe("Project tools", () => {
    test("list-projects", async () => {
      const res = await callTool("list-projects");
      expect(res).toBeArray();
      expect(res[0].name).toBe("My Project");
    });

    test("create-project", async () => {
      const res = await callTool("create-project", { name: "New Project" });
      expect(res.id).toBe("proj-2");
      expect(res.name).toBe("New Project");
    });

    test("get-project", async () => {
      const res = await callTool("get-project", { projectId: "proj-1" });
      expect(res.name).toBe("My Project");
    });

    test("update-project", async () => {
      const res = await callTool("update-project", { projectId: "proj-1", name: "Renamed" });
      expect(res.name).toBe("Renamed");
    });

    test("delete-project", async () => {
      const res = await callTool("delete-project", { projectId: "proj-1" });
      expect(res.ok).toBe(true);
    });

    test("add-project-repo", async () => {
      const res = await callTool("add-project-repo", {
        projectId: "proj-1", repoPath: "org/repo",
      });
      expect(res.repoPath).toBe("org/repo");
    });

    test("remove-project-repo", async () => {
      const res = await callTool("remove-project-repo", {
        projectId: "proj-1", repoPath: "org/repo",
      });
      expect(res.ok).toBe(true);
    });
  });

  // ---- Skill tools ----------------------------------------------------------

  describe("Skill tools", () => {
    test("list-skills", async () => {
      const res = await callTool("list-skills", {});
      expect(res).toBeArray();
      expect(res[0].slug).toBe("default");
    });

    test("list-repo-skills", async () => {
      const res = await callTool("list-repo-skills", { owner: "org", repo: "repo1" });
      expect(res).toBeArray();
      expect(res[0].slug).toBe("repo-skill");
    });

    test("install-skill", async () => {
      const res = await callTool("install-skill", { url: "https://example.com/skill.md" });
      expect(res.slug).toBe("new-skill");
    });

    test("sync-skills", async () => {
      const res = await callTool("sync-skills");
      expect(res.ok).toBe(true);
    });
  });

  // ---- Inbox tools ----------------------------------------------------------

  describe("Inbox tools", () => {
    test("list-inbox", async () => {
      const res = await callTool("list-inbox", {});
      expect(res.items).toBeArray();
    });

    test("inbox-count", async () => {
      const res = await callTool("inbox-count");
      expect(res.unread).toBe(3);
    });

    test("dismiss-inbox", async () => {
      const res = await callTool("dismiss-inbox", { eventIds: ["evt-1"] });
      expect(res.ok).toBe(true);
    });
  });

  // ---- Mirror tools ---------------------------------------------------------

  describe("Mirror tools", () => {
    test("list-mirrors", async () => {
      const res = await callTool("list-mirrors", {});
      expect(res.mirrors).toBeArray();
    });

    test("create-mirror", async () => {
      const res = await callTool("create-mirror", {
        syncConnectionId: "conn-1",
        localRepoPath: "org/repo",
        remoteRepoUrl: "https://github.com/org/repo.git",
        direction: "pull",
      });
      expect(res.id).toBe("m-2");
    });

    test("sync-mirror", async () => {
      const res = await callTool("sync-mirror", { mirrorId: "m-1" });
      expect(res.synced).toBe(true);
    });

    test("delete-mirror", async () => {
      const res = await callTool("delete-mirror", { mirrorId: "m-1" });
      expect(res.ok).toBe(true);
    });

    test("resolve-mirror-conflict", async () => {
      const res = await callTool("resolve-mirror-conflict", {
        mirrorId: "m-1", strategy: "force-push",
      });
      expect(res.resolved).toBe(true);
    });
  });

  // ---- Model tools ----------------------------------------------------------

  describe("Model tools", () => {
    test("list-models", async () => {
      const res = await callTool("list-models");
      expect(res).toBeArray();
      expect(res[0].id).toBe("claude-4");
    });
  });

  // ---- Settings tools -------------------------------------------------------

  describe("Settings tools", () => {
    test("list-api-keys", async () => {
      const res = await callTool("list-api-keys");
      expect(res).toBeArray();
      expect(res[0].provider).toBe("anthropic");
    });

    test("create-api-key", async () => {
      const res = await callTool("create-api-key", {
        provider: "anthropic", apiKey: "sk-test-key",
      });
      expect(res.id).toBe("key-2");
    });

    test("update-api-key", async () => {
      const res = await callTool("update-api-key", { keyId: "key-1", label: "Production" });
      expect(res.ok).toBe(true);
    });

    test("delete-api-key", async () => {
      const res = await callTool("delete-api-key", { keyId: "key-1" });
      expect(res.ok).toBe(true);
    });
  });

  // ---- Notification tools ---------------------------------------------------

  describe("Notification tools", () => {
    test("list-notifications", async () => {
      const res = await callTool("list-notifications", {});
      expect(res.items).toBeArray();
    });
  });

  // ---- Invite tools ---------------------------------------------------------

  describe("Invite tools", () => {
    test("list-invites", async () => {
      const res = await callTool("list-invites");
      expect(res).toBeArray();
    });

    test("create-invite", async () => {
      const res = await callTool("create-invite", { username: "newuser" });
      expect(res.username).toBe("newuser");
    });
  });
});

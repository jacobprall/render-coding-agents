import { z } from "zod";
import { getForgeProviderForAuth } from "@coding-agents/platform/forge";
import type { ToolRegistrar } from "./helpers";
import { textResult } from "./helpers";

export const registerRepoTools: ToolRegistrar = (server, p, auth) => {
  // -- Discovery ---------------------------------------------------------------

  server.registerTool("list-repos", {
    title: "List Repositories",
    description: "List repositories accessible to the current user.",
  }, async () => {
    const forge = getForgeProviderForAuth(auth);
    const repos = await forge.repos.list();
    return textResult(repos);
  });

  server.registerTool("search-repos", {
    title: "Search Repositories",
    description: "Search repositories by name or keyword.",
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      limit: z.number().optional().describe("Max results (default 20)"),
    }),
  }, async ({ query, limit }) => {
    const forge = getForgeProviderForAuth(auth);
    const repos = await forge.repos.search(query, limit ?? 20);
    return textResult(repos);
  });

  server.registerTool("list-branches", {
    title: "List Branches",
    description: "List branches of a repository.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
    }),
  }, async ({ owner, repo }) => {
    const forge = getForgeProviderForAuth(auth);
    const branches = await forge.branches.list(owner, repo);
    return textResult(branches);
  });

  // -- Import ------------------------------------------------------------------

  server.registerTool("import-repo", {
    title: "Import Repository",
    description: "Import an external git repository into the forge.",
    inputSchema: z.object({
      cloneAddr: z.string().describe("URL to clone from"),
      repoName: z.string().describe("Name for the imported repo"),
      repoOwner: z.string().optional().describe("Owner (defaults to current user)"),
      mirror: z.boolean().optional().describe("Set up as mirror"),
      service: z.enum(["git", "github"]).optional(),
      authToken: z.string().optional().describe("Auth token for private repos"),
    }),
  }, async (args) => {
    const { repo } = await p.repos.importRepo(auth, args);
    return textResult(repo);
  });

  // -- File operations ---------------------------------------------------------

  server.registerTool("get-file-contents", {
    title: "Get File Contents",
    description: "Read a file from a repository.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      filePath: z.string(),
      ref: z.string().optional().describe("Branch, tag, or commit SHA"),
    }),
  }, async ({ owner, repo, filePath, ref }) => {
    const result = await p.repos.getFileContents(auth, owner, repo, filePath, ref);
    return textResult(result);
  });

  server.registerTool("put-file-contents", {
    title: "Write File Contents",
    description: "Create or update a file in a repository.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      filePath: z.string(),
      content: z.string().describe("Base64-encoded file content"),
      message: z.string().describe("Commit message"),
      branch: z.string().optional(),
      sha: z.string().optional().describe("Current SHA for updates"),
    }),
  }, async ({ owner, repo, filePath, content, message, branch, sha }) => {
    const result = await p.repos.putFileContents(auth, owner, repo, filePath, { content, message, branch, sha });
    return textResult(result);
  });

  // -- Agent config ------------------------------------------------------------

  server.registerTool("get-agent-config", {
    title: "Get Agent Config",
    description: "Read .forge/agent.json configuration for a repository.",
    inputSchema: z.object({ owner: z.string(), repo: z.string() }),
  }, async ({ owner, repo }) => {
    const result = await p.repos.getAgentConfig(auth, owner, repo);
    return textResult(result);
  });

  server.registerTool("write-agent-config", {
    title: "Write Agent Config",
    description: "Create or update .forge/agent.json for a repository.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      content: z.string().describe("JSON content for agent.json"),
      path: z.string().optional().describe("Config file path override"),
      sha: z.string().optional().describe("Current SHA for updates"),
      message: z.string().optional().describe("Commit message"),
    }),
  }, async ({ owner, repo, ...data }) => {
    const result = await p.repos.writeAgentConfig(auth, owner, repo, data);
    return textResult(result);
  });

  // -- Branch protection -------------------------------------------------------

  server.registerTool("list-branch-protections", {
    title: "List Branch Protections",
    description: "List branch protection rules for a repository.",
    inputSchema: z.object({ owner: z.string(), repo: z.string() }),
  }, async ({ owner, repo }) => {
    const rules = await p.repos.listBranchProtections(auth, owner, repo);
    return textResult(rules);
  });

  server.registerTool("get-branch-protection", {
    title: "Get Branch Protection",
    description: "Get branch protection rules for a specific branch.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      branch: z.string(),
    }),
  }, async ({ owner, repo, branch }) => {
    const rule = await p.repos.getBranchProtection(auth, owner, repo, branch);
    return textResult(rule);
  });

  server.registerTool("set-branch-protection", {
    title: "Set Branch Protection",
    description: "Create or update a branch protection rule.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      pattern: z.string().describe("Branch name pattern (e.g. 'main')"),
    }).passthrough(),
  }, async ({ owner, repo, ...data }) => {
    const rule = await p.repos.setBranchProtection(auth, owner, repo, data as any);
    return textResult(rule);
  });

  server.registerTool("delete-branch-protection", {
    title: "Delete Branch Protection",
    description: "Remove branch protection for a branch.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      branch: z.string(),
    }),
  }, async ({ owner, repo, branch }) => {
    await p.repos.deleteBranchProtection(auth, owner, repo, branch);
    return textResult({ ok: true });
  });

  // -- Secrets -----------------------------------------------------------------

  server.registerTool("list-repo-secrets", {
    title: "List Repository Secrets",
    description: "List secrets configured on a repository.",
    inputSchema: z.object({ owner: z.string(), repo: z.string() }),
  }, async ({ owner, repo }) => {
    const result = await p.repos.listSecrets(auth, owner, repo);
    return textResult(result);
  });

  server.registerTool("set-repo-secret", {
    title: "Set Repository Secret",
    description: "Create or update a secret on a repository.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      name: z.string(),
      value: z.string(),
    }),
  }, async ({ owner, repo, name, value }) => {
    await p.repos.setSecret(auth, owner, repo, name, value);
    return textResult({ ok: true });
  });

  server.registerTool("delete-repo-secret", {
    title: "Delete Repository Secret",
    description: "Remove a secret from a repository.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      name: z.string(),
    }),
  }, async ({ owner, repo, name }) => {
    await p.repos.deleteSecret(auth, owner, repo, name);
    return textResult({ ok: true });
  });

  // -- CI / Actions ------------------------------------------------------------

  server.registerTool("get-test-results", {
    title: "Get Test Results",
    description: "Retrieve parsed test results for a CI run.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      runId: z.string(),
    }),
  }, async ({ owner, repo, runId }) => {
    const result = await p.repos.getTestResults(auth, owner, repo, runId);
    return textResult(result);
  });

  server.registerTool("list-artifacts", {
    title: "List Artifacts",
    description: "List artifacts produced by a CI run.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      runId: z.string(),
    }),
  }, async ({ owner, repo, runId }) => {
    const artifacts = await p.repos.listArtifacts(auth, owner, repo, runId);
    return textResult(artifacts);
  });

  server.registerTool("get-job-logs", {
    title: "Get Job Logs",
    description: "Retrieve logs for a CI job.",
    inputSchema: z.object({
      owner: z.string(),
      repo: z.string(),
      jobId: z.string(),
    }),
  }, async ({ owner, repo, jobId }) => {
    const logs = await p.repos.getJobLogs(auth, owner, repo, jobId);
    return textResult({ logs });
  });
};

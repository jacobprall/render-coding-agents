import { Hono } from "hono";
import { z } from "zod";
import type { GatewayEnv } from "../middleware/auth";
import { getPlatform } from "../platform";
import { formatZodError } from "../middleware/validation";

export const repoRoutes = new Hono<GatewayEnv>();

// ---------------------------------------------------------------------------
// POST /import
// ---------------------------------------------------------------------------

const ImportRepoSchema = z.object({
  cloneAddr: z.string(),
  repoName: z.string(),
  repoOwner: z.string().optional(),
  mirror: z.boolean().optional(),
  service: z.enum(["git", "github"]).optional(),
  authToken: z.string().optional(),
  syncConnectionId: z.string().optional(),
});

repoRoutes.post("/import", async (c) => {
  const auth = c.get("auth");
  const body = ImportRepoSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  const { repo, deferredTasks } = await getPlatform().repos.importRepo(auth, body.data);

  // Fire-and-forget deferred tasks after responding
  if (deferredTasks.length > 0) {
    const run = () => deferredTasks.forEach((t) => t().catch(() => {}));
    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(Promise.all(deferredTasks.map((t) => t())));
    } else {
      run();
    }
  }

  return c.json({ repo }, 201);
});

// ---------------------------------------------------------------------------
// GET /:owner/:repo/contents/*path
// ---------------------------------------------------------------------------

repoRoutes.get("/:owner/:repo/contents/*", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const filePath = c.req.param("*") ?? "";
  const ref = c.req.query("ref");

  const contents = await getPlatform().repos.getFileContents(auth, owner, repo, filePath, ref);
  return c.json(contents);
});

// ---------------------------------------------------------------------------
// PUT /:owner/:repo/contents/*path
// ---------------------------------------------------------------------------

const PutFileSchema = z.object({
  content: z.string(),
  message: z.string(),
  sha: z.string().optional(),
  branch: z.string().optional(),
});

repoRoutes.put("/:owner/:repo/contents/*", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const filePath = c.req.param("*") ?? "";
  const body = PutFileSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  const result = await getPlatform().repos.putFileContents(auth, owner, repo, filePath, body.data);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /:owner/:repo/agent-config
// ---------------------------------------------------------------------------

repoRoutes.get("/:owner/:repo/agent-config", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const config = await getPlatform().repos.getAgentConfig(auth, owner, repo);
  return c.json(config);
});

// ---------------------------------------------------------------------------
// POST /:owner/:repo/agent-config
// ---------------------------------------------------------------------------

const WriteAgentConfigSchema = z.object({
  content: z.string(),
  path: z.string().optional(),
  sha: z.string().optional(),
  message: z.string().optional(),
});

repoRoutes.post("/:owner/:repo/agent-config", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const body = WriteAgentConfigSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  const result = await getPlatform().repos.writeAgentConfig(auth, owner, repo, body.data);
  return c.json(result);
});

// ---------------------------------------------------------------------------
// Branch protection
// ---------------------------------------------------------------------------

repoRoutes.get("/:owner/:repo/branch-protection", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const rules = await getPlatform().repos.listBranchProtections(auth, owner, repo);
  return c.json(rules);
});

const SetBranchProtectionSchema = z
  .object({ pattern: z.string() })
  .passthrough();

repoRoutes.post("/:owner/:repo/branch-protection", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const body = SetBranchProtectionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  const rule = await getPlatform().repos.setBranchProtection(auth, owner, repo, body.data);
  return c.json(rule);
});

repoRoutes.get("/:owner/:repo/branch-protection/:branch", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const branch = c.req.param("branch");
  const rule = await getPlatform().repos.getBranchProtection(auth, owner, repo, branch);
  return c.json(rule);
});

repoRoutes.delete("/:owner/:repo/branch-protection/:branch", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const branch = c.req.param("branch");
  await getPlatform().repos.deleteBranchProtection(auth, owner, repo, branch);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

repoRoutes.get("/:owner/:repo/secrets", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const secrets = await getPlatform().repos.listSecrets(auth, owner, repo);
  return c.json(secrets);
});

const SetSecretSchema = z.object({ value: z.string().min(1) });

repoRoutes.put("/:owner/:repo/secrets/:name", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const name = c.req.param("name");
  const body = SetSecretSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  await getPlatform().repos.setSecret(auth, owner, repo, name, body.data.value);
  return c.json({ ok: true });
});

repoRoutes.delete("/:owner/:repo/secrets/:name", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const name = c.req.param("name");
  await getPlatform().repos.deleteSecret(auth, owner, repo, name);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Actions: test results, artifacts, job logs
// ---------------------------------------------------------------------------

repoRoutes.get("/:owner/:repo/actions/runs/:runId/test-results", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const runId = c.req.param("runId");
  const results = await getPlatform().repos.getTestResults(auth, owner, repo, runId);
  return c.json(results);
});

repoRoutes.get("/:owner/:repo/actions/runs/:runId/artifacts", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const runId = c.req.param("runId");
  const artifacts = await getPlatform().repos.listArtifacts(auth, owner, repo, runId);
  return c.json(artifacts);
});

repoRoutes.get("/:owner/:repo/actions/artifacts/:artifactId", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const artifactId = c.req.param("artifactId");
  const data = await getPlatform().repos.downloadArtifact(auth, owner, repo, artifactId);
  return new Response(data, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${artifactId}"`,
    },
  });
});

repoRoutes.get("/:owner/:repo/actions/jobs/:jobId/logs", async (c) => {
  const auth = c.get("auth");
  const owner = c.req.param("owner");
  const repo = c.req.param("repo");
  const jobId = c.req.param("jobId");
  const logs = await getPlatform().repos.getJobLogs(auth, owner, repo, jobId);
  return c.text(logs);
});

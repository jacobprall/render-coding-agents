import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { syncConnections } from "@openforge/db";
import type { GatewayEnv } from "../middleware/auth";
import { getPlatform } from "../platform";
import { getForgeProviderForAuth, createForgeProvider, type ForgeProviderType } from "@openforge/platform/forge";
import { formatZodError } from "../middleware/validation";

export const sessionRoutes = new Hono<GatewayEnv>();

/**
 * Resolve the best forge provider for a user by checking sync connections first,
 * falling back to the auth-context forge. This avoids depending on Forgejo when
 * the user has a GitHub/GitLab sync connection.
 */
async function resolveForgeForUser(auth: { userId: string; forgeToken: string; forgeType?: "forgejo" | "github" | "gitlab" }): Promise<ReturnType<typeof getForgeProviderForAuth>> {
  const db = getPlatform().db;
  const [conn] = await db
    .select({ provider: syncConnections.provider, accessToken: syncConnections.accessToken })
    .from(syncConnections)
    .where(eq(syncConnections.userId, auth.userId))
    .limit(1);

  if (conn?.accessToken) {
    const baseUrl = conn.provider === "github" ? "https://api.github.com" : "https://gitlab.com";
    return createForgeProvider({ type: conn.provider as ForgeProviderType, baseUrl, token: conn.accessToken });
  }

  return getForgeProviderForAuth(auth);
}

const CreateSessionSchema = z.object({
  repoPath: z.string().optional(),
  branch: z.string().optional(),
  baseBranch: z.string().optional(),
  title: z.string().optional(),
  forgeType: z.enum(["forgejo", "github", "gitlab"]).optional(),
  activeSkills: z
    .array(z.object({ source: z.enum(["builtin", "user", "repo"]), slug: z.string() }))
    .optional(),
  firstMessage: z.string().optional(),
  modelId: z.string().optional(),
  projectId: z.string().optional(),
});

sessionRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  const body = CreateSessionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  const data = body.data;
  const platform = getPlatform();
  const branch = data.repoPath ? (data.branch || data.baseBranch || "main") : undefined;

  let projectId = data.projectId;
  if (projectId) {
    const project = await platform.projects.get(auth, projectId);
    if (!project) return c.json({ error: "Project not found" }, 404);
  } else if (data.repoPath) {
    const project = await platform.projects.findOrCreateForRepo(auth, data.repoPath, data.forgeType);
    projectId = project.id;
  } else {
    const scratch = await platform.projects.getScratchProject(auth);
    projectId = scratch.id;
  }

  const result = await platform.sessions.create(auth, { ...data, branch, projectId });
  return c.json({ id: result.sessionId, ...result }, 201);
});

const reposCache = new Map<string, { data: unknown; expiresAt: number }>();
const REPOS_CACHE_TTL = 120_000; // 2 minutes

sessionRoutes.get("/repos", async (c) => {
  const auth = c.get("auth");
  const cacheKey = auth.userId;
  const cached = reposCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return c.json(cached.data);
  }

  const db = getPlatform().db;
  const allRepos: unknown[] = [];

  // Try sync connections first (GitHub, GitLab) -- these don't depend on Forgejo
  const conns = await db
    .select({ provider: syncConnections.provider, accessToken: syncConnections.accessToken })
    .from(syncConnections)
    .where(eq(syncConnections.userId, auth.userId));

  for (const conn of conns) {
    try {
      const baseUrl = conn.provider === "github" ? "https://api.github.com" : "https://gitlab.com";
      const forge = createForgeProvider({
        type: conn.provider as ForgeProviderType,
        baseUrl,
        token: conn.accessToken,
      });
      const repos = await forge.repos.list();
      allRepos.push(...repos);
    } catch (err) {
      console.warn(`[sessions/repos] failed to list repos from ${conn.provider}:`, err instanceof Error ? err.message : err);
    }
  }

  // If no repos from sync connections, fall back to auth forge (may be Forgejo)
  if (allRepos.length === 0) {
    try {
      const forge = getForgeProviderForAuth(auth);
      const repos = await forge.repos.list();
      allRepos.push(...repos);
    } catch (err) {
      console.warn("[sessions/repos] auth forge fallback failed:", err instanceof Error ? err.message : err);
    }
  }

  const payload = { repos: allRepos };
  reposCache.set(cacheKey, { data: payload, expiresAt: Date.now() + REPOS_CACHE_TTL });
  return c.json(payload);
});

const branchesCache = new Map<string, { data: unknown; expiresAt: number }>();
const BRANCHES_CACHE_TTL = 120_000;

sessionRoutes.get("/repos/:repoPath/branches", async (c) => {
  const auth = c.get("auth");
  const repoPath = decodeURIComponent(c.req.param("repoPath"));
  const [owner, repo] = repoPath.split("/");
  if (!owner || !repo) return c.json({ error: "Invalid repo path" }, 400);

  const cacheKey = `${auth.userId}:${repoPath}`;
  const cached = branchesCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return c.json(cached.data);
  }

  const forge = await resolveForgeForUser(auth);
  const branches = await forge.branches.list(owner, repo);
  const payload = { branches };
  branchesCache.set(cacheKey, { data: payload, expiresAt: Date.now() + BRANCHES_CACHE_TTL });
  return c.json(payload);
});

sessionRoutes.post("/repos/:repoPath/branches", async (c) => {
  const auth = c.get("auth");
  const repoPath = decodeURIComponent(c.req.param("repoPath"));
  const [owner, repo] = repoPath.split("/");
  if (!owner || !repo) return c.json({ error: "Invalid repo path" }, 400);

  const body = z
    .object({ name: z.string().min(1), from: z.string().optional() })
    .safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  const forge = await resolveForgeForUser(auth);
  const fromBranch = body.data.from ?? "main";
  const branch = await forge.branches.create(owner, repo, body.data.name, fromBranch);

  // Bust the branches cache for this repo
  branchesCache.delete(`${auth.userId}:${repoPath}`);

  return c.json({ branch }, 201);
});

const SendMessageSchema = z.object({
  content: z.string(),
  modelId: z.string().optional(),
  requestId: z.string().optional(),
});

sessionRoutes.post("/:id/message", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const body = SendMessageSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  const requestId = c.req.header("x-request-id");
  const result = await getPlatform().sessions.sendMessage(auth, sessionId, {
    ...body.data,
    requestId: requestId ?? undefined,
  });

  return c.json({
    success: true,
    messageId: result.messageId,
    runId: result.runId,
    isFirstMessage: result.isFirstMessage,
  });
});

const ReplySchema = z.object({
  toolCallId: z.string(),
  message: z.string(),
  runId: z.string().optional(),
});

sessionRoutes.post("/:id/reply", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const body = ReplySchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);
  await getPlatform().sessions.reply(auth, sessionId, body.data);
  return c.json({ ok: true });
});

sessionRoutes.post("/:id/stop", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const result = await getPlatform().sessions.stop(auth, sessionId);
  return c.json(result);
});

sessionRoutes.post("/:id/pause", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const result = await getPlatform().sessions.pause(auth, sessionId);
  return c.json(result);
});

sessionRoutes.post("/:id/resume", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const result = await getPlatform().sessions.resume(auth, sessionId);
  return c.json(result);
});

const UpdatePhaseSchema = z.object({ phase: z.string() });

sessionRoutes.post("/:id/phase", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const body = UpdatePhaseSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);
  await getPlatform().sessions.updatePhase(auth, sessionId, body.data.phase);
  return c.json({ ok: true });
});

sessionRoutes.patch("/:id/config", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const body = await c.req.json();
  const result = await getPlatform().sessions.updateConfig(auth, sessionId, body);
  return c.json(result);
});

sessionRoutes.get("/:id/skills", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const skills = await getPlatform().sessions.getSkills(auth, sessionId);
  return c.json(skills);
});

const UpdateSkillsSchema = z.object({
  skills: z.array(
    z.object({ source: z.enum(["builtin", "user", "repo"]), slug: z.string() }),
  ),
});

sessionRoutes.patch("/:id/skills", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const body = UpdateSkillsSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);
  await getPlatform().sessions.updateSkills(auth, sessionId, body.data.skills);
  return c.json({ ok: true });
});

const SpecActionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  specId: z.string(),
  rejectionNote: z.string().optional(),
});

sessionRoutes.post("/:id/spec", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const body = SpecActionSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);
  const result = await getPlatform().sessions.handleSpecAction(auth, sessionId, body.data);
  return c.json(result);
});

sessionRoutes.post("/:id/auto-title", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const result = await getPlatform().sessions.generateAutoTitle(sessionId, auth.userId);
  return c.json(result);
});

sessionRoutes.get("/:id/ci-events", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const events = await getPlatform().sessions.listCiEvents(auth, sessionId);
  return c.json(events);
});

const ReviewJobSchema = z
  .object({ fixContext: z.string().optional() })
  .optional();

sessionRoutes.post("/:id/review", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const raw = await c.req.json().catch(() => undefined);
  const body = ReviewJobSchema.safeParse(raw);
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);
  const result = await getPlatform().sessions.enqueueReviewJob(auth, sessionId, body.data);
  return c.json(result ?? { ok: true });
});

sessionRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  await getPlatform().sessions.archive(auth, sessionId);
  return c.json({ ok: true });
});

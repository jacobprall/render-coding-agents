import { Hono } from "hono";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { projects, projectRepos } from "@coding-agents/db";
import type { GatewayEnv } from "../middleware/auth";
import { getPlatform } from "../platform";
import { formatZodError } from "../middleware/validation";

export const workspaceRoutes = new Hono<GatewayEnv>();

const SkillSchema = z.object({
  source: z.enum(["builtin", "user", "repo"]),
  slug: z.string(),
});

export const WorkspaceConfigUpdateSchema = z.object({
  environmentConfig: z.record(z.string(), z.string()).optional(),
  secretsConfig: z.object({
    env: z.record(z.string(), z.string()).optional(),
    runtime: z.record(z.string(), z.string()).optional(),
    build: z.record(z.string(), z.string()).optional(),
  }).optional(),
  computeDefaults: z.object({
    model: z.string().optional(),
    maxSteps: z.number().int().positive().optional(),
    timeout: z.number().int().positive().optional(),
  }).optional(),
  defaultSkills: z.array(SkillSchema).optional(),
});

const MirrorStatusSchema = z.object({
  status: z.enum(["initializing", "ready", "syncing", "stale", "error"]),
  lastFetchedAt: z.string().nullable(),
  sizeBytes: z.number(),
  errorMessage: z.string().optional(),
  diskPath: z.string().optional(),
});

const WorkspaceSecretsResponseSchema = z.object({
  env: z.record(z.string(), z.string()),
  runtime: z.array(z.string()),
  build: z.array(z.string()),
});

const WorkspaceRepoSchema = z.object({
  repoPath: z.string(),
  isPrimary: z.boolean(),
  defaultBranch: z.string(),
  forgeType: z.string().nullable().optional(),
});

export const WorkspaceResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  environmentConfig: z.record(z.string(), z.string()),
  secretsConfig: WorkspaceSecretsResponseSchema,
  computeDefaults: z.record(z.string(), z.unknown()),
  defaultSkills: z.array(SkillSchema),
  repoMirrorStatus: z.record(z.string(), MirrorStatusSchema),
  repos: z.array(WorkspaceRepoSchema),
});

export const MirrorsResponseSchema = z.object({
  mirrors: z.record(z.string(), MirrorStatusSchema),
  totalSizeBytes: z.number(),
  diskUsagePercent: z.number().nullable(),
});

export const MirrorSyncRequestSchema = z.object({}).strict();

export const MirrorSyncResponseSchema = z.object({
  message: z.string(),
  repos: z.array(z.string()),
});

type SecretsConfigStored = {
  env?: Record<string, string>;
  runtime?: Record<string, string>;
  build?: Record<string, string>;
};

function formatSecretsConfigForResponse(secretsConfig: SecretsConfigStored | null) {
  const config = secretsConfig ?? {};
  return {
    env: config.env ?? {},
    runtime: Object.keys(config.runtime ?? {}),
    build: Object.keys(config.build ?? {}),
  };
}


// GET /projects/:projectId/workspace
workspaceRoutes.get("/projects/:projectId/workspace", async (c) => {
  const projectId = c.req.param("projectId");
  const db = getPlatform().db;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return c.json({ error: "Project not found" }, 404);

  const repos = await db
    .select({
      repoPath: projectRepos.repoPath,
      isPrimary: projectRepos.isPrimary,
      defaultBranch: projectRepos.defaultBranch,
      forgeType: projectRepos.forgeType,
    })
    .from(projectRepos)
    .where(eq(projectRepos.projectId, projectId));

  const response = {
    id: project.id,
    name: project.name,
    environmentConfig: project.environmentConfig ?? {},
    secretsConfig: formatSecretsConfigForResponse(
      project.secretsConfig as SecretsConfigStored | null,
    ),
    computeDefaults: project.computeDefaults ?? {},
    defaultSkills: project.defaultSkills ?? [],
    repoMirrorStatus: project.repoMirrorStatus ?? {},
    repos: repos.map((r) => ({
      repoPath: r.repoPath,
      isPrimary: r.isPrimary,
      defaultBranch: r.defaultBranch ?? "main",
      forgeType: r.forgeType,
    })),
  };

  return c.json(response);
});

// PUT /projects/:projectId/workspace
workspaceRoutes.put("/projects/:projectId/workspace", async (c) => {
  const auth = c.get("auth");
  const projectId = c.req.param("projectId");
  const db = getPlatform().db;

  const [project] = await db
    .select({ id: projects.id, orgId: projects.orgId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return c.json({ error: "Project not found" }, 404);

  if (!auth.isAdmin) {
    return c.json({ error: "Only org admins can configure workspaces" }, 403);
  }

  const body = WorkspaceConfigUpdateSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  const data = body.data;
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (data.environmentConfig !== undefined) {
    updates.environmentConfig = data.environmentConfig;
  }
  if (data.secretsConfig !== undefined) {
    updates.secretsConfig = data.secretsConfig;
  }
  if (data.computeDefaults !== undefined) {
    updates.computeDefaults = data.computeDefaults;
  }
  if (data.defaultSkills !== undefined) {
    updates.defaultSkills = data.defaultSkills;
  }

  await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, projectId));

  const [updated] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const repos = await db
    .select({
      repoPath: projectRepos.repoPath,
      isPrimary: projectRepos.isPrimary,
      defaultBranch: projectRepos.defaultBranch,
    })
    .from(projectRepos)
    .where(eq(projectRepos.projectId, projectId));

  const response = {
    id: updated!.id,
    name: updated!.name,
    environmentConfig: updated!.environmentConfig ?? {},
    secretsConfig: formatSecretsConfigForResponse(
      updated!.secretsConfig as SecretsConfigStored | null,
    ),
    computeDefaults: updated!.computeDefaults ?? {},
    defaultSkills: updated!.defaultSkills ?? [],
    repoMirrorStatus: updated!.repoMirrorStatus ?? {},
    repos: repos.map((r) => ({
      repoPath: r.repoPath,
      isPrimary: r.isPrimary,
      defaultBranch: r.defaultBranch ?? "main",
    })),
  };

  return c.json(response);
});

const SANDBOX_URL = process.env.SANDBOX_URL ?? "http://localhost:3001";
const SANDBOX_SECRET = process.env.SANDBOX_SHARED_SECRET;

// GET /projects/:projectId/mirrors
workspaceRoutes.get("/projects/:projectId/mirrors", async (c) => {
  const projectId = c.req.param("projectId");
  const db = getPlatform().db;

  const [project] = await db
    .select({
      repoMirrorStatus: projects.repoMirrorStatus,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return c.json({ error: "Project not found" }, 404);

  let diskStatus: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`${SANDBOX_URL}/disk/status`, {
      headers: SANDBOX_SECRET ? { Authorization: `Bearer ${SANDBOX_SECRET}` } : {},
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) diskStatus = (await res.json()) as Record<string, unknown>;
  } catch {
    /* non-fatal */
  }

  const mirrors = (project.repoMirrorStatus as Record<string, { sizeBytes?: number }>) ?? {};
  const totalSizeBytes = Object.values(mirrors).reduce(
    (sum, m) => sum + (m?.sizeBytes ?? 0),
    0,
  );

  const response = {
    mirrors,
    totalSizeBytes,
    diskUsagePercent: typeof diskStatus?.usagePercent === "number" ? diskStatus.usagePercent : null,
  };

  return c.json(response);
});

// POST /projects/:projectId/mirrors/sync
workspaceRoutes.post("/projects/:projectId/mirrors/sync", async (c) => {
  const auth = c.get("auth");
  const projectId = c.req.param("projectId");
  const db = getPlatform().db;

  if (!auth.isAdmin) {
    return c.json({ error: "Only org admins can trigger mirror sync" }, 403);
  }

  const rawBody = await c.req.json().catch(() => ({}));
  const body = MirrorSyncRequestSchema.safeParse(rawBody);
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) return c.json({ error: "Project not found" }, 404);

  const repos = await db
    .select({ repoPath: projectRepos.repoPath })
    .from(projectRepos)
    .where(eq(projectRepos.projectId, projectId));

  for (const { repoPath } of repos) {
    void fetch(`${SANDBOX_URL}/mirror/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(SANDBOX_SECRET ? { Authorization: `Bearer ${SANDBOX_SECRET}` } : {}),
      },
      body: JSON.stringify({ workspaceId: projectId, repoPath }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {});
  }

  const response = {
    message: "Mirror sync initiated",
    repos: repos.map((r) => r.repoPath),
  };

  return c.json(response, 202);
});

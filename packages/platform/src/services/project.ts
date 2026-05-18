import { and, count, desc, eq, inArray } from "drizzle-orm";
import { projects, projectRepos, sessions, orgs } from "@openforge/db";
import type { Project, ProjectRepo } from "@openforge/db";
import type { PlatformDb } from "../interfaces/database";
import type { AuthContext } from "../interfaces/auth";

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

export interface CreateProjectParams {
  name: string;
  slug?: string;
  instructions?: string;
  config?: Record<string, unknown>;
  repoPath?: string;
  forgeType?: "forgejo" | "github" | "gitlab";
}

export interface UpdateProjectParams {
  name?: string;
  slug?: string;
  instructions?: string;
  config?: Record<string, unknown>;
}

export interface ProjectWithRepos extends Project {
  repos: ProjectRepo[];
  sessionCount: number;
}

// ---------------------------------------------------------------------------
// ProjectService
// ---------------------------------------------------------------------------

export class ProjectService {
  constructor(private db: PlatformDb) {}

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  async create(auth: AuthContext, params: CreateProjectParams): Promise<Project> {
    const org = await this.resolveOrg();
    const slug = params.slug || this.slugify(params.name);

    const id = crypto.randomUUID();
    const [project] = await this.db
      .insert(projects)
      .values({
        id,
        orgId: org.id,
        name: params.name,
        slug,
        instructions: params.instructions ?? null,
        config: params.config ?? null,
        createdBy: auth.userId,
      })
      .returning();

    if (params.repoPath) {
      await this.db.insert(projectRepos).values({
        id: crypto.randomUUID(),
        projectId: id,
        repoPath: params.repoPath,
        forgeType: params.forgeType ?? null,
        isPrimary: true,
      });
    }

    return project;
  }

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  async list(auth: AuthContext): Promise<ProjectWithRepos[]> {
    const org = await this.resolveOrg();
    const rows = await this.db
      .select()
      .from(projects)
      .where(eq(projects.orgId, org.id))
      .orderBy(desc(projects.updatedAt));

    if (rows.length === 0) return [];

    const ids = rows.map((p) => p.id);

    const [allRepos, sessionCounts] = await Promise.all([
      this.db
        .select()
        .from(projectRepos)
        .where(inArray(projectRepos.projectId, ids)),
      this.db
        .select({ projectId: sessions.projectId, value: count() })
        .from(sessions)
        .where(inArray(sessions.projectId, ids))
        .groupBy(sessions.projectId),
    ]);

    const reposByProject = new Map<string, ProjectRepo[]>();
    for (const r of allRepos) {
      const arr = reposByProject.get(r.projectId) ?? [];
      arr.push(r);
      reposByProject.set(r.projectId, arr);
    }

    const countByProject = new Map<string, number>();
    for (const c of sessionCounts) {
      if (c.projectId) countByProject.set(c.projectId, c.value);
    }

    return rows.map((p) => ({
      ...p,
      repos: reposByProject.get(p.id) ?? [],
      sessionCount: countByProject.get(p.id) ?? 0,
    }));
  }

  // -------------------------------------------------------------------------
  // get
  // -------------------------------------------------------------------------

  async get(auth: AuthContext, projectId: string): Promise<ProjectWithRepos | null> {
    const org = await this.resolveOrg();
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, org.id)))
      .limit(1);
    if (!project) return null;

    const repos = await this.db
      .select()
      .from(projectRepos)
      .where(eq(projectRepos.projectId, projectId));
    const [{ value: sessionCount }] = await this.db
      .select({ value: count() })
      .from(sessions)
      .where(eq(sessions.projectId, projectId));

    return { ...project, repos, sessionCount };
  }

  // -------------------------------------------------------------------------
  // update
  // -------------------------------------------------------------------------

  async update(auth: AuthContext, projectId: string, params: UpdateProjectParams): Promise<Project> {
    const org = await this.resolveOrg();
    const [existing] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, org.id)))
      .limit(1);
    if (!existing) throw new Error("Project not found");
    if (existing.createdBy !== auth.userId && !auth.isAdmin) {
      throw new Error("You don't have permission to modify this project");
    }

    const [updated] = await this.db
      .update(projects)
      .set({ ...params, updatedAt: new Date() })
      .where(eq(projects.id, projectId))
      .returning();
    return updated;
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(auth: AuthContext, projectId: string): Promise<void> {
    const org = await this.resolveOrg();
    const [existing] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, org.id)))
      .limit(1);
    if (!existing) throw new Error("Project not found");
    if (existing.createdBy !== auth.userId && !auth.isAdmin) {
      throw new Error("You don't have permission to modify this project");
    }
    await this.db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, org.id)));
  }

  // -------------------------------------------------------------------------
  // addRepo / removeRepo
  // -------------------------------------------------------------------------

  async addRepo(
    auth: AuthContext,
    projectId: string,
    params: { repoPath: string; forgeType?: string; defaultBranch?: string },
  ): Promise<ProjectRepo> {
    const org = await this.resolveOrg();
    const [project] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, org.id)))
      .limit(1);
    if (!project) throw new Error("Project not found");
    if (project.createdBy !== auth.userId && !auth.isAdmin) {
      throw new Error("You don't have permission to modify this project");
    }
    const existing = await this.db
      .select()
      .from(projectRepos)
      .where(and(eq(projectRepos.projectId, projectId), eq(projectRepos.repoPath, params.repoPath)))
      .limit(1);
    if (existing.length > 0) return existing[0];

    const [row] = await this.db
      .insert(projectRepos)
      .values({
        id: crypto.randomUUID(),
        projectId,
        repoPath: params.repoPath,
        forgeType: params.forgeType as "forgejo" | "github" | "gitlab" | undefined,
        defaultBranch: params.defaultBranch ?? "main",
        isPrimary: false,
      })
      .returning();
    return row;
  }

  async removeRepo(auth: AuthContext, projectId: string, repoPath: string): Promise<void> {
    const org = await this.resolveOrg();
    const [existing] = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, org.id)))
      .limit(1);
    if (!existing) throw new Error("Project not found");
    if (existing.createdBy !== auth.userId && !auth.isAdmin) {
      throw new Error("You don't have permission to modify this project");
    }
    await this.db
      .delete(projectRepos)
      .where(and(eq(projectRepos.projectId, projectId), eq(projectRepos.repoPath, repoPath)));
  }

  // -------------------------------------------------------------------------
  // getScratchProject — get or create the user's scratch project
  // -------------------------------------------------------------------------

  async getScratchProject(auth: AuthContext): Promise<Project> {
    const org = await this.resolveOrg();

    const [existing] = await this.db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.orgId, org.id),
          eq(projects.isScratch, true),
          eq(projects.createdBy, auth.userId),
        ),
      )
      .limit(1);
    if (existing) return existing;

    const id = crypto.randomUUID();
    const [created] = await this.db
      .insert(projects)
      .values({
        id,
        orgId: org.id,
        name: "Scratch",
        slug: `scratch-${auth.userId}`,
        isScratch: true,
        createdBy: auth.userId,
      })
      .returning();
    return created;
  }

  // -------------------------------------------------------------------------
  // findProjectForRepo — find or create a project for a given repoPath
  // -------------------------------------------------------------------------

  async findOrCreateForRepo(
    auth: AuthContext,
    repoPath: string,
    forgeType?: string,
  ): Promise<Project> {
    const org = await this.resolveOrg();

    const linkedRepo = await this.db
      .select({ projectId: projectRepos.projectId })
      .from(projectRepos)
      .innerJoin(projects, eq(projects.id, projectRepos.projectId))
      .where(
        and(
          eq(projectRepos.repoPath, repoPath),
          eq(projects.orgId, org.id),
        ),
      )
      .limit(1);

    if (linkedRepo.length > 0) {
      const [project] = await this.db
        .select()
        .from(projects)
        .where(eq(projects.id, linkedRepo[0].projectId))
        .limit(1);
      return project;
    }

    const repoName = repoPath.includes("/") ? repoPath.split("/").pop()! : repoPath;
    return this.create(auth, {
      name: repoName,
      slug: repoPath.replace(/\//g, "-"),
      repoPath,
      forgeType: forgeType as "forgejo" | "github" | "gitlab" | undefined,
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async resolveOrg() {
    const [org] = await this.db.select().from(orgs).limit(1);
    if (!org) throw new Error("Organization not configured");
    return org;
  }

  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }
}

import { eq } from "drizzle-orm";
import { projects, projectRepos, mirrorSyncLog } from "@coding-agents/db";
import { encryptToken, decryptToken } from "@coding-agents/shared/lib/encryption";
import type {
  ResolvedWorkspaceConfig,
  SecretsConfig,
  MirrorSyncTrigger,
  MirrorSyncStatus,
} from "@coding-agents/shared/lib/workspace-types";
import type { PlatformDb } from "../interfaces/database";

function secretKeyNames(secrets: SecretsConfig): {
  env: string[];
  runtime: string[];
  build: string[];
} {
  return {
    env: Object.keys(secrets.env ?? {}),
    runtime: Object.keys(secrets.runtime ?? {}),
    build: Object.keys(secrets.build ?? {}),
  };
}

export async function resolveWorkspaceConfig(
  db: PlatformDb,
  projectId: string,
): Promise<ResolvedWorkspaceConfig> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const repos = await db
    .select({
      repoPath: projectRepos.repoPath,
      forgeType: projectRepos.forgeType,
      defaultBranch: projectRepos.defaultBranch,
      isPrimary: projectRepos.isPrimary,
    })
    .from(projectRepos)
    .where(eq(projectRepos.projectId, projectId));

  const environmentConfig = (project.environmentConfig as Record<string, string>) ?? {};
  const secretsConfig = (project.secretsConfig as SecretsConfig) ?? {};
  const defaultSkills =
    (project.defaultSkills as Array<{ source: "builtin" | "user" | "repo"; slug: string }>) ?? [];
  const secretKeys = secretKeyNames(secretsConfig);
  const secretCount =
    secretKeys.env.length + secretKeys.runtime.length + secretKeys.build.length;

  console.info(
    JSON.stringify({
      event: "workspace_config_resolved",
      projectId,
      envCount: Object.keys(environmentConfig).length,
      skillsCount: defaultSkills.length,
      repoCount: repos.length,
      secretCount,
    }),
  );

  return {
    environmentConfig,
    secretsConfig,
    computeDefaults: (project.computeDefaults as Record<string, unknown>) ?? {},
    defaultSkills,
    repos: repos.map((r) => ({
      repoPath: r.repoPath,
      forgeType: r.forgeType as "github" | "gitlab" | null,
      defaultBranch: r.defaultBranch ?? "main",
      isPrimary: r.isPrimary,
    })),
  };
}

export function mergeSessionOverrides(
  workspace: ResolvedWorkspaceConfig,
  sessionEnvOverrides: Record<string, string>,
  sessionSkillsOverrides: Array<{ source: "builtin" | "user" | "repo"; slug: string }>,
): { mergedEnv: Record<string, string>; mergedSkills: Array<{ source: "builtin" | "user" | "repo"; slug: string }> } {
  const conflicting = Object.keys(sessionEnvOverrides).filter(
    (key) => key in workspace.environmentConfig,
  );
  if (conflicting.length > 0) {
    console.warn(
      JSON.stringify({
        event: "workspace_overrides_conflict",
        conflictingEnvKeys: conflicting,
      }),
    );
    throw new Error(
      `Session env overrides cannot shadow workspace keys: ${conflicting.join(", ")}`,
    );
  }

  console.info(
    JSON.stringify({
      event: "workspace_overrides_merged",
      addedEnvKeys: Object.keys(sessionEnvOverrides),
      addedEnvCount: Object.keys(sessionEnvOverrides).length,
      addedSkills: sessionSkillsOverrides.map((s) => s.slug),
      addedSkillsCount: sessionSkillsOverrides.length,
      totalEnvCount:
        Object.keys(workspace.environmentConfig).length +
        Object.keys(sessionEnvOverrides).length,
      totalSkillsCount: workspace.defaultSkills.length + sessionSkillsOverrides.length,
    }),
  );

  return {
    mergedEnv: { ...workspace.environmentConfig, ...sessionEnvOverrides },
    mergedSkills: [...workspace.defaultSkills, ...sessionSkillsOverrides],
  };
}

export async function updateMirrorStatus(
  db: PlatformDb,
  projectId: string,
  repoPath: string,
  status: { status: string; lastFetchedAt: string | null; sizeBytes: number; errorMessage?: string; diskPath?: string },
): Promise<void> {
  const [project] = await db
    .select({ repoMirrorStatus: projects.repoMirrorStatus })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);

  const current = (project?.repoMirrorStatus as Record<string, unknown>) ?? {};
  const updated = { ...current, [repoPath]: status };

  console.info(
    JSON.stringify({
      event: "mirror_status_updated",
      projectId,
      repoPath,
      status: status.status,
      sizeBytes: status.sizeBytes,
      lastFetchedAt: status.lastFetchedAt,
      ...(status.errorMessage ? { error: status.errorMessage } : {}),
    }),
  );

  await db
    .update(projects)
    .set({
      repoMirrorStatus: updated,
      lastMirrorSyncedAt: status.lastFetchedAt ? new Date(status.lastFetchedAt) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
}

export async function logMirrorSync(
  db: PlatformDb,
  projectId: string,
  repoPath: string,
  trigger: MirrorSyncTrigger,
  status: MirrorSyncStatus,
  durationMs: number,
  error?: string,
): Promise<void> {
  await db.insert(mirrorSyncLog).values({
    projectId,
    repoPath,
    trigger,
    status,
    durationMs,
    errorMessage: error ?? null,
  });
}

export function encryptSecrets(secrets: SecretsConfig): SecretsConfig {
  const encrypt = (tier: Record<string, string> | undefined): Record<string, string> => {
    if (!tier) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(tier)) {
      result[key] = encryptToken(value);
    }
    return result;
  };

  return {
    env: encrypt(secrets.env),
    runtime: encrypt(secrets.runtime),
    build: encrypt(secrets.build),
  };
}

export function decryptSecrets(secrets: SecretsConfig): SecretsConfig {
  const decrypt = (tier: Record<string, string> | undefined): Record<string, string> => {
    if (!tier) return {};
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(tier)) {
      result[key] = decryptToken(value);
    }
    return result;
  };

  const keys = secretKeyNames(secrets);
  const secretCount = keys.env.length + keys.runtime.length + keys.build.length;

  console.info(
    JSON.stringify({
      event: "workspace_secrets_injected",
      secretCount,
      secretKeys: keys,
    }),
  );

  return {
    env: decrypt(secrets.env),
    runtime: decrypt(secrets.runtime),
    build: decrypt(secrets.build),
  };
}

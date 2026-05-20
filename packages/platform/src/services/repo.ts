import { and, eq } from "drizzle-orm";
import { ciEvents, mirrors, syncConnections } from "@coding-agents/db";
import {
  parseJUnitXML,
  parseTAPOutput,
  type TestResultSummary,
  ValidationError,
  logger,
} from "@coding-agents/shared";
import type { PlatformDb } from "../interfaces/database";
import type { AuthContext } from "../interfaces/auth";
import { getForgeProviderForAuth } from "../forge/factory";
import { decryptTokenSafe } from "../auth/encryption";
import type {
  ForgeRepo,
  ForgeFileContent,
  BranchProtectionRule,
  ForgeArtifact,
  PutFileParams,
} from "../forge/types";

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

export interface ImportRepoParams {
  cloneAddr: string;
  repoName: string;
  repoOwner?: string;
  mirror?: boolean;
  service?: "git" | "github" | "gitlab" | "gitea" | "forgejo";
  authToken?: string;
  syncConnectionId?: string;
}

export interface ImportRepoResult {
  repo: ForgeRepo;
  /** Fire-and-forget callbacks the caller should schedule (e.g. via Next.js `after()`). */
  deferredTasks: Array<() => Promise<void>>;
}

export interface AgentConfigResult {
  path: string | null;
  content: string | null;
  sha: string | null;
}

export interface WriteAgentConfigParams {
  content: string;
  path?: string;
  sha?: string;
  message?: string;
  branch?: string;
}

export interface TestResultsResult {
  testResults: TestResultSummary | null;
  message?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_CONFIG_PATHS = [".forge/agents.yml", ".forge/agents.json"] as const;

// ---------------------------------------------------------------------------
// RepoService
// ---------------------------------------------------------------------------

export class RepoService {
  constructor(private db: PlatformDb) {}

  // -------------------------------------------------------------------------
  // importRepo — POST /api/repos/import
  // -------------------------------------------------------------------------

  async importRepo(
    auth: AuthContext,
    params: ImportRepoParams,
  ): Promise<ImportRepoResult> {
    const forge = getForgeProviderForAuth(auth);
    const repoOwner = params.repoOwner ?? auth.username;

    // Resolve auth token: use explicit value or look up from sync connection
    let authToken = params.authToken;
    if (!authToken && params.syncConnectionId) {
      const [conn] = await this.db
        .select({ accessToken: syncConnections.accessToken })
        .from(syncConnections)
        .where(eq(syncConnections.id, params.syncConnectionId))
        .limit(1);
      authToken = conn?.accessToken ? decryptTokenSafe(conn.accessToken) : undefined;
    }

    const repo = await forge.repos.migrate({
      cloneAddr: params.cloneAddr,
      repoName: params.repoName,
      repoOwner,
      mirror: params.mirror ?? false,
      service: params.service,
      authToken,
    });

    const deferredTasks: Array<() => Promise<void>> = [];

    // Trigger an immediate mirror-sync so branches/commits are available right away
    if (params.mirror) {
      const [owner, repoName] = repo.fullName.split("/");
      if (owner && repoName) {
        const forgejoUrl =
          process.env.FORGEJO_INTERNAL_URL ?? "http://localhost:3000";
        const agentToken = process.env.FORGEJO_AGENT_TOKEN;
        if (agentToken) {
          deferredTasks.push(async () => {
            try {
              const res = await fetch(
                `${forgejoUrl}/api/v1/repos/${owner}/${repoName}/mirror-sync`,
                {
                  method: "POST",
                  headers: { Authorization: `token ${agentToken}` },
                },
              );
              if (!res.ok) {
                logger.error("mirror-sync failed after import", {
                  repo: repo.fullName,
                  status: res.status,
                });
              }
            } catch (err) {
              logger.errorWithCause(err, "mirror-sync failed after import", {
                repo: repo.fullName,
              });
            }
          });
        }
      }
    }

    // Create a DB mirror-tracking record for external provider connections
    if (
      params.mirror &&
      params.service &&
      ["github", "gitlab"].includes(params.service)
    ) {
      let connectionId = params.syncConnectionId;
      if (!connectionId) {
        const [conn] = await this.db
          .select({ id: syncConnections.id })
          .from(syncConnections)
          .where(
            and(
              eq(syncConnections.userId, auth.userId),
              eq(
                syncConnections.provider,
                params.service as "github" | "gitlab",
              ),
            ),
          )
          .limit(1);
        connectionId = conn?.id;
      }

      if (connectionId) {
        const localRepoPath = repo.fullName;
        const remoteRepoUrl = params.cloneAddr;
        const db = this.db;
        const effectiveConnectionId = connectionId;

        deferredTasks.push(async () => {
          try {
            await db.insert(mirrors).values({
              id: crypto.randomUUID(),
              syncConnectionId: effectiveConnectionId,
              localRepoPath,
              remoteRepoUrl,
              direction: "pull",
              status: "active",
            });
          } catch (err) {
            logger.errorWithCause(err, "createMirror record failed after import", {
              repo: localRepoPath,
            });
          }
        });
      }
    }

    return { repo, deferredTasks };
  }

  // -------------------------------------------------------------------------
  // getFileContents — GET /api/repos/[owner]/[repo]/contents/[...path]
  // -------------------------------------------------------------------------

  async getFileContents(
    auth: AuthContext,
    owner: string,
    repo: string,
    path: string,
    ref?: string,
  ): Promise<ForgeFileContent | ForgeFileContent[]> {
    const forge = getForgeProviderForAuth(auth);
    return forge.files.getContents(owner, repo, path, ref);
  }

  // -------------------------------------------------------------------------
  // putFileContents — PUT /api/repos/[owner]/[repo]/contents/[...path]
  // -------------------------------------------------------------------------

  async putFileContents(
    auth: AuthContext,
    owner: string,
    repo: string,
    path: string,
    params: PutFileParams,
  ): Promise<ForgeFileContent> {
    if (params.content === undefined) {
      throw new ValidationError("content is required");
    }
    if (!params.message) {
      throw new ValidationError("message is required");
    }
    const forge = getForgeProviderForAuth(auth);
    return forge.files.putFile(owner, repo, path, params);
  }

  // -------------------------------------------------------------------------
  // getAgentConfig — GET /api/repos/[owner]/[repo]/agent-config
  // -------------------------------------------------------------------------

  async getAgentConfig(
    auth: AuthContext,
    owner: string,
    repo: string,
  ): Promise<AgentConfigResult> {
    const forge = getForgeProviderForAuth(auth);
    for (const configPath of AGENT_CONFIG_PATHS) {
      try {
        const file = await forge.files.getContents(owner, repo, configPath);
        if (!Array.isArray(file) && file.type === "file" && file.content) {
          const decoded = Buffer.from(file.content, "base64").toString("utf-8");
          return { path: configPath, content: decoded, sha: file.sha };
        }
      } catch {
        continue;
      }
    }
    return { path: null, content: null, sha: null };
  }

  // -------------------------------------------------------------------------
  // writeAgentConfig — POST /api/repos/[owner]/[repo]/agent-config
  // -------------------------------------------------------------------------

  async writeAgentConfig(
    auth: AuthContext,
    owner: string,
    repo: string,
    params: WriteAgentConfigParams,
  ): Promise<{ ok: boolean; file: ForgeFileContent }> {
    if (typeof params.content !== "string" || params.content.trim().length === 0) {
      throw new ValidationError("content is required");
    }

    const filePath = params.path ?? ".forge/agents.json";
    const commitMessage = params.message ?? "Update agent configuration";
    const forge = getForgeProviderForAuth(auth);

    let sha = params.sha;
    if (!sha) {
      try {
        const existing = await forge.files.getContents(owner, repo, filePath);
        if (!Array.isArray(existing) && existing.sha) {
          sha = existing.sha;
        }
      } catch {
        // File doesn't exist yet; will be created
      }
    }

    const file = sha
      ? await forge.files.putFile(owner, repo, filePath, {
          content: params.content,
          message: commitMessage,
          sha,
          branch: params.branch,
        })
      : await forge.files.createFile(owner, repo, filePath, {
          content: params.content,
          message: commitMessage,
          branch: params.branch,
        });

    return { ok: true, file };
  }

  // -------------------------------------------------------------------------
  // listBranchProtections — GET /api/repos/[owner]/[repo]/branch-protection
  // -------------------------------------------------------------------------

  async listBranchProtections(
    auth: AuthContext,
    owner: string,
    repo: string,
  ): Promise<BranchProtectionRule[]> {
    const forge = getForgeProviderForAuth(auth);
    return forge.branches.listProtectionRules(owner, repo);
  }

  // -------------------------------------------------------------------------
  // setBranchProtection — POST /api/repos/[owner]/[repo]/branch-protection
  // -------------------------------------------------------------------------

  async setBranchProtection(
    auth: AuthContext,
    owner: string,
    repo: string,
    rule: Partial<BranchProtectionRule> & { pattern: string },
  ): Promise<BranchProtectionRule> {
    const forge = getForgeProviderForAuth(auth);
    return forge.branches.setProtectionRule(owner, repo, rule);
  }

  // -------------------------------------------------------------------------
  // getBranchProtection — GET /api/repos/[owner]/[repo]/branch-protection/[branch]
  // -------------------------------------------------------------------------

  async getBranchProtection(
    auth: AuthContext,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<BranchProtectionRule> {
    const forge = getForgeProviderForAuth(auth);
    const protection = await forge.branches.getProtectionRule(owner, repo, branch);
    if (!protection) {
      throw new ValidationError(`Branch protection rule not found: ${branch}`);
    }
    return protection;
  }

  // -------------------------------------------------------------------------
  // deleteBranchProtection — DELETE /api/repos/[owner]/[repo]/branch-protection/[branch]
  // -------------------------------------------------------------------------

  async deleteBranchProtection(
    auth: AuthContext,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<void> {
    const forge = getForgeProviderForAuth(auth);
    await forge.branches.deleteProtectionRule(owner, repo, branch);
  }

  // -------------------------------------------------------------------------
  // listSecrets — GET /api/repos/[owner]/[repo]/secrets
  // -------------------------------------------------------------------------

  async listSecrets(
    auth: AuthContext,
    owner: string,
    repo: string,
  ): Promise<Array<{ name: string }>> {
    const forge = getForgeProviderForAuth(auth);
    const names = await forge.secrets.list(owner, repo);
    return names.map((name) => ({ name }));
  }

  // -------------------------------------------------------------------------
  // setSecret — PUT /api/repos/[owner]/[repo]/secrets/[name]
  // -------------------------------------------------------------------------

  async setSecret(
    auth: AuthContext,
    owner: string,
    repo: string,
    name: string,
    value: string,
  ): Promise<void> {
    if (!value || value.length === 0) {
      throw new ValidationError("Secret value is required");
    }
    const forge = getForgeProviderForAuth(auth);
    await forge.secrets.set(owner, repo, name, value);
  }

  // -------------------------------------------------------------------------
  // deleteSecret — DELETE /api/repos/[owner]/[repo]/secrets/[name]
  // -------------------------------------------------------------------------

  async deleteSecret(
    auth: AuthContext,
    owner: string,
    repo: string,
    name: string,
  ): Promise<void> {
    const forge = getForgeProviderForAuth(auth);
    await forge.secrets.delete(owner, repo, name);
  }

  // -------------------------------------------------------------------------
  // getTestResults — GET /api/repos/[owner]/[repo]/actions/runs/[runId]/test-results
  // -------------------------------------------------------------------------

  async getTestResults(
    auth: AuthContext,
    owner: string,
    repo: string,
    runId: string,
  ): Promise<TestResultsResult> {
    // owner/repo are accepted for API consistency but the lookup is by runId
    void auth;
    void owner;
    void repo;

    const event = await this.db
      .select()
      .from(ciEvents)
      .where(eq(ciEvents.runId, runId))
      .then((r) => r[0] ?? null);

    if (!event) {
      const eventById = await this.db
        .select()
        .from(ciEvents)
        .where(eq(ciEvents.id, runId))
        .then((r) => r[0] ?? null);

      if (!eventById) {
        throw new ValidationError("Run not found");
      }

      return this.parseTestResultsFromPayload(
        eventById.payload as Record<string, unknown> | null,
      );
    }

    return this.parseTestResultsFromPayload(
      event.payload as Record<string, unknown> | null,
    );
  }

  // -------------------------------------------------------------------------
  // listArtifacts — GET /api/repos/[owner]/[repo]/actions/runs/[runId]/artifacts
  // -------------------------------------------------------------------------

  async listArtifacts(
    auth: AuthContext,
    owner: string,
    repo: string,
    runId: string,
  ): Promise<ForgeArtifact[]> {
    const forge = getForgeProviderForAuth(auth);
    return forge.ci.listArtifacts(owner, repo, runId);
  }

  // -------------------------------------------------------------------------
  // downloadArtifact — GET /api/repos/[owner]/[repo]/actions/artifacts/[artifactId]
  // -------------------------------------------------------------------------

  async downloadArtifact(
    auth: AuthContext,
    owner: string,
    repo: string,
    artifactId: string,
  ): Promise<ArrayBuffer> {
    const forge = getForgeProviderForAuth(auth);
    return forge.ci.downloadArtifact(owner, repo, artifactId);
  }

  // -------------------------------------------------------------------------
  // getJobLogs — GET /api/repos/[owner]/[repo]/actions/jobs/[jobId]/logs
  // -------------------------------------------------------------------------

  async getJobLogs(
    auth: AuthContext,
    owner: string,
    repo: string,
    jobId: string,
  ): Promise<string> {
    const forge = getForgeProviderForAuth(auth);
    return forge.ci.getJobLogs(owner, repo, jobId);
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private parseTestResultsFromPayload(
    payload: Record<string, unknown> | null,
  ): TestResultsResult {
    if (!payload) {
      return { testResults: null, message: "No payload available" };
    }

    const xmlFields = ["junit_xml", "test_xml", "testResults", "test_results"];
    const tapFields = ["tap_output", "tap", "test_output"];

    for (const field of xmlFields) {
      const val = payload[field];
      if (typeof val === "string" && val.includes("<testsuite")) {
        try {
          return { testResults: parseJUnitXML(val) };
        } catch {
          continue;
        }
      }
    }

    for (const field of tapFields) {
      const val = payload[field];
      if (
        typeof val === "string" &&
        (/^(not )?ok\s/m.test(val) || /^TAP version/m.test(val))
      ) {
        try {
          return { testResults: parseTAPOutput(val) };
        } catch {
          continue;
        }
      }
    }

    // Check nested workflow_run payload
    const wr = payload.workflow_run as Record<string, unknown> | undefined;
    if (wr) {
      for (const field of xmlFields) {
        const val = wr[field];
        if (typeof val === "string" && val.includes("<testsuite")) {
          try {
            return { testResults: parseJUnitXML(val) };
          } catch {
            continue;
          }
        }
      }
    }

    return { testResults: null, message: "No test results found in payload" };
  }
}

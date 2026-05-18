import { and, desc, eq, inArray } from "drizzle-orm";
import { mirrors, syncConnections } from "@openforge/db";
import { ValidationError, logger } from "@openforge/shared";
import type { PlatformDb } from "../interfaces/database";
import type { AuthContext } from "../interfaces/auth";
import { decryptTokenSafe } from "../auth/encryption";
import { getDefaultForgeProvider } from "../forge/factory";

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

export interface CreateMirrorParams {
  syncConnectionId: string;
  localRepoPath: string;
  remoteRepoUrl: string;
  direction: "pull" | "push" | "bidirectional";
  /** If omitted, auto-resolved from the sync connection's access token. */
  remoteToken?: string;
  sessionId?: string;
}

export interface ListMirrorsParams {
  limit: number;
  offset: number;
}

export type ConflictStrategy = "force-push" | "manual" | "rebase";

export interface ConflictResolutionResult {
  resolved: boolean;
  strategy: ConflictStrategy;
  error?: string;
}

// ---------------------------------------------------------------------------
// MirrorService
// ---------------------------------------------------------------------------

export class MirrorService {
  constructor(private db: PlatformDb) {}

  // -------------------------------------------------------------------------
  // list — GET /api/mirrors
  // -------------------------------------------------------------------------

  async list(
    auth: AuthContext,
    params: ListMirrorsParams,
  ): Promise<Array<typeof mirrors.$inferSelect>> {
    const userConnections = await this.db
      .select({ id: syncConnections.id })
      .from(syncConnections)
      .where(eq(syncConnections.userId, auth.userId));

    if (userConnections.length === 0) return [];

    return this.db
      .select()
      .from(mirrors)
      .where(inArray(mirrors.syncConnectionId, userConnections.map((c) => c.id)))
      .orderBy(desc(mirrors.createdAt))
      .limit(params.limit + 1)
      .offset(params.offset);
  }

  // -------------------------------------------------------------------------
  // create — POST /api/mirrors
  // -------------------------------------------------------------------------

  async create(
    auth: AuthContext,
    params: CreateMirrorParams,
  ): Promise<typeof mirrors.$inferSelect> {
    if (!params.syncConnectionId || !params.localRepoPath || !params.remoteRepoUrl || !params.direction) {
      throw new ValidationError("Missing required fields: syncConnectionId, localRepoPath, remoteRepoUrl, direction");
    }

    const validDirections = ["pull", "push", "bidirectional"] as const;
    if (!validDirections.includes(params.direction)) {
      throw new ValidationError(`Invalid direction. Must be one of: ${validDirections.join(", ")}`);
    }

    // Verify the sync connection belongs to this user
    const [conn] = await this.db
      .select()
      .from(syncConnections)
      .where(
        and(
          eq(syncConnections.id, params.syncConnectionId),
          eq(syncConnections.userId, auth.userId),
        ),
      )
      .limit(1);

    if (!conn) {
      throw new ValidationError("Sync connection not found or not owned by user");
    }

    const [owner, repo] = this.splitRepoPath(params.localRepoPath);

    let token = params.remoteToken ?? null;
    if (!token && conn.accessToken) {
      token = decryptTokenSafe(conn.accessToken);
    }
    if (!token) {
      throw new ValidationError("Unable to resolve remote token for sync connection");
    }

    if (params.direction === "push" || params.direction === "bidirectional") {
      await this.configurePushMirror(owner, repo, params.remoteRepoUrl, token).catch((err) => {
        logger.errorWithCause(err, "push mirror setup failed", { repo: params.localRepoPath });
      });
    }

    if (params.direction === "pull" || params.direction === "bidirectional") {
      await this.configurePullMirror(owner, repo, params.remoteRepoUrl, token).catch((err) => {
        logger.errorWithCause(err, "pull mirror setup failed", { repo: params.localRepoPath });
      });
    }

    const [row] = await this.db
      .insert(mirrors)
      .values({
        id: crypto.randomUUID(),
        sessionId: params.sessionId ?? null,
        syncConnectionId: params.syncConnectionId,
        localRepoPath: params.localRepoPath,
        remoteRepoUrl: params.remoteRepoUrl,
        direction: params.direction,
        status: "active",
      })
      .returning();

    return row;
  }

  // -------------------------------------------------------------------------
  // sync — POST /api/mirrors/[id]/sync
  // -------------------------------------------------------------------------

  async sync(auth: AuthContext, mirrorId: string): Promise<void> {
    const mirror = await this.getMirrorIfOwned(mirrorId, auth.userId);
    if (!mirror) throw new ValidationError("Mirror not found");

    const [owner, repo] = this.splitRepoPath(mirror.localRepoPath);
    await this.forgejoApi(`/repos/${owner}/${repo}/mirror-sync`, { method: "POST" });

    await this.db
      .update(mirrors)
      .set({ lastSyncAt: new Date() })
      .where(eq(mirrors.id, mirrorId));
  }

  // -------------------------------------------------------------------------
  // delete — DELETE /api/mirrors/[id]
  // -------------------------------------------------------------------------

  async delete(auth: AuthContext, mirrorId: string): Promise<void> {
    const mirror = await this.getMirrorIfOwned(mirrorId, auth.userId);
    if (!mirror) throw new ValidationError("Mirror not found");

    const [owner, repo] = this.splitRepoPath(mirror.localRepoPath);

    if (mirror.direction === "push" || mirror.direction === "bidirectional") {
      await this.removePushMirrorsForUrl(owner, repo, mirror.remoteRepoUrl);
    }

    await this.db.delete(mirrors).where(eq(mirrors.id, mirrorId));
  }

  // -------------------------------------------------------------------------
  // resolveConflict — POST /api/mirrors/[id]/resolve
  // -------------------------------------------------------------------------

  async resolveConflict(
    auth: AuthContext,
    mirrorId: string,
    strategy: ConflictStrategy = "manual",
  ): Promise<ConflictResolutionResult> {
    const mirror = await this.getMirrorIfOwned(mirrorId, auth.userId);
    if (!mirror) return { resolved: false, strategy, error: "Mirror not found" };

    const [owner, repo] = this.splitRepoPath(mirror.localRepoPath);

    if (strategy === "manual") {
      await this.db
        .update(mirrors)
        .set({ status: "error" })
        .where(eq(mirrors.id, mirrorId));
      return { resolved: false, strategy, error: "Marked for manual resolution" };
    }

    if (strategy === "force-push") {
      try {
        await this.forgejoApi(`/repos/${owner}/${repo}/mirror-sync`, { method: "POST" });
        await this.db
          .update(mirrors)
          .set({ status: "active", lastSyncAt: new Date() })
          .where(eq(mirrors.id, mirrorId));
        return { resolved: true, strategy };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        await this.db
          .update(mirrors)
          .set({ status: "error" })
          .where(eq(mirrors.id, mirrorId));
        return { resolved: false, strategy, error: msg };
      }
    }

    // rebase: attempt normal sync (Forgejo handles fast-forward when possible)
    try {
      await this.forgejoApi(`/repos/${owner}/${repo}/mirror-sync`, { method: "POST" });
      await this.db
        .update(mirrors)
        .set({ status: "active", lastSyncAt: new Date() })
        .where(eq(mirrors.id, mirrorId));
      return { resolved: true, strategy };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      return { resolved: false, strategy, error: msg };
    }
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /** Verify that a mirror belongs to the given user via its sync connection. */
  private async getMirrorIfOwned(
    mirrorId: string,
    userId: string,
  ): Promise<typeof mirrors.$inferSelect | null> {
    const [mirror] = await this.db
      .select()
      .from(mirrors)
      .where(eq(mirrors.id, mirrorId))
      .limit(1);

    if (!mirror) return null;

    const [conn] = await this.db
      .select()
      .from(syncConnections)
      .where(
        and(
          eq(syncConnections.id, mirror.syncConnectionId),
          eq(syncConnections.userId, userId),
        ),
      )
      .limit(1);

    return conn ? mirror : null;
  }

  private splitRepoPath(repoPath: string): [string, string] {
    const [owner, repo] = repoPath.split("/");
    if (!owner || !repo) throw new ValidationError(`Invalid repo path: ${repoPath}`);
    return [owner, repo];
  }

  private getForgejoBaseUrl(): string {
    return (process.env.FORGEJO_INTERNAL_URL ?? "http://localhost:3000").replace(/\/$/, "");
  }

  private getAgentToken(): string {
    const token = process.env.FORGEJO_AGENT_TOKEN;
    if (!token) throw new ValidationError("FORGEJO_AGENT_TOKEN not configured");
    return token;
  }

  private async forgejoApi<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.getForgejoBaseUrl()}/api/v1${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `token ${this.getAgentToken()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Forgejo API ${res.status}: ${res.statusText} - ${body}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text || !text.trim()) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
  }

  private async configurePushMirror(
    owner: string,
    repo: string,
    remoteUrl: string,
    remoteToken: string,
  ): Promise<void> {
    await this.forgejoApi(`/repos/${owner}/${repo}/push_mirrors`, {
      method: "POST",
      body: JSON.stringify({
        remote_address: remoteUrl,
        remote_username: "",
        remote_password: remoteToken,
        interval: "8h0m0s",
        sync_on_commit: true,
      }),
    });
  }

  private async configurePullMirror(
    owner: string,
    repo: string,
    remoteUrl: string,
    remoteToken: string,
  ): Promise<void> {
    const forge = getDefaultForgeProvider(this.getAgentToken());
    await forge.repos
      .migrate({
        cloneAddr: remoteUrl,
        repoName: repo,
        repoOwner: owner,
        mirror: true,
        authToken: remoteToken,
      })
      .catch(() => {
        // Repo already exists — attempt to update mirror settings
        return this.forgejoApi(`/repos/${owner}/${repo}`, {
          method: "PATCH",
          body: JSON.stringify({ mirror: true, mirror_interval: "8h0m0s" }),
        });
      });
  }

  private async removePushMirrorsForUrl(
    owner: string,
    repo: string,
    remoteUrl: string,
  ): Promise<void> {
    const pushMirrors = await this.forgejoApi<Array<{ id: number; remote_address: string }>>(
      `/repos/${owner}/${repo}/push_mirrors`,
    ).catch(() => [] as Array<{ id: number; remote_address: string }>);

    for (const pm of pushMirrors) {
      if (pm.remote_address === remoteUrl) {
        await this.forgejoApi(`/repos/${owner}/${repo}/push_mirrors/${pm.id}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
    }
  }
}

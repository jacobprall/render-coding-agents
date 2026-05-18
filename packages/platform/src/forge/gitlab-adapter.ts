/**
 * GitLabProvider — adapts the GitLab REST API to the ForgeProvider interface.
 *
 * Currently implements the subset needed for upstream mirror operations:
 * git clone URLs and merge request creation. Other operations throw
 * "not implemented" and can be filled in as needed.
 */

import type {
  ForgePullRequest,
  CreatePRParams,
} from "./types";

import type {
  ForgeProvider,
  RepoOperations,
  FileOperations,
  BranchOperations,
  CommitOperations,
  PullRequestOperations,
  ReviewOperations,
  CIOperations,
  RepoSecretOperations,
  OrgOperations,
  MirrorOperations,
  AuthOperations,
  WebhookOperations,
  GitOperations,
} from "./provider";

import { timingSafeEqual } from "node:crypto";

function notImplemented(op: string): never {
  throw new Error(`GitLabProvider: ${op} not yet implemented`);
}

export class GitLabProvider implements ForgeProvider {
  readonly type = "gitlab" as const;
  readonly label = "GitLab";
  readonly baseUrl: string;

  private token: string;
  private webhookSecret: string;

  repos: RepoOperations;
  files: FileOperations;
  branches: BranchOperations;
  commits: CommitOperations;
  pulls: PullRequestOperations;
  reviews: ReviewOperations;
  ci: CIOperations;
  secrets: RepoSecretOperations;
  orgs: OrgOperations;
  mirrors: MirrorOperations;
  auth: AuthOperations;
  webhooks: WebhookOperations;
  git: GitOperations;

  constructor(baseUrl: string, token: string, webhookSecret?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
    this.webhookSecret = webhookSecret ?? process.env.GITLAB_WEBHOOK_SECRET ?? "";

    this.repos = this.buildRepoOps();
    this.files = this.buildFileOps();
    this.branches = this.buildBranchOps();
    this.commits = this.buildCommitOps();
    this.pulls = this.buildPullOps();
    this.reviews = this.buildReviewOps();
    this.ci = this.buildCIOps();
    this.secrets = this.buildSecretOps();
    this.orgs = this.buildOrgOps();
    this.mirrors = this.buildMirrorOps();
    this.auth = this.buildAuthOps();
    this.webhooks = this.buildWebhookOps();
    this.git = this.buildGitOps();
  }

  // ─── API helper ─────────────────────────────────────────────────────────

  private async api<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v4${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        "PRIVATE-TOKEN": this.token,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`GitLab API ${res.status}: ${res.statusText} - ${body}`);
    }
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  // ─── Pulls / Merge Requests (implemented) ───────────────────────────────

  private buildPullOps(): PullRequestOperations {
    return {
      list: () => notImplemented("pulls.list"),
      get: () => notImplemented("pulls.get"),

      create: async (params: CreatePRParams): Promise<ForgePullRequest> => {
        const projectId = encodeURIComponent(`${params.owner}/${params.repo}`);
        const raw = await this.api<Record<string, unknown>>(
          `/projects/${projectId}/merge_requests`,
          {
            method: "POST",
            body: JSON.stringify({
              title: params.title,
              description: params.body ?? "",
              source_branch: params.head,
              target_branch: params.base,
            }),
          },
        );

        const author = raw.author as Record<string, unknown> | undefined;

        return {
          id: raw.id as number,
          number: raw.iid as number,
          title: (raw.title as string) ?? "",
          body: (raw.description as string) ?? "",
          state: (raw.state as string) === "opened" ? "open" : "closed",
          merged: (raw.state as string) === "merged",
          htmlUrl: (raw.web_url as string) ?? "",
          headRef: (raw.source_branch as string) ?? params.head,
          headSha: (raw.sha as string) ?? "",
          baseRef: (raw.target_branch as string) ?? params.base,
          baseSha: "",
          author: (author?.username as string) ?? "",
          createdAt: (raw.created_at as string) ?? "",
          updatedAt: (raw.updated_at as string) ?? "",
        };
      },

      update: () => notImplemented("pulls.update"),
      merge: () => notImplemented("pulls.merge"),
      diff: () => notImplemented("pulls.diff"),
    };
  }

  // ─── Git (implemented) ──────────────────────────────────────────────────

  private buildGitOps(): GitOperations {
    const token = this.token;
    const host = new URL(this.baseUrl).host;
    return {
      authenticatedCloneUrl(owner: string, repo: string): string {
        return `https://oauth2:${token}@${host}/${owner}/${repo}.git`;
      },
      plainCloneUrl(owner: string, repo: string): string {
        return `https://${host}/${owner}/${repo}.git`;
      },
    };
  }

  // ─── Stubs ──────────────────────────────────────────────────────────────

  private buildRepoOps(): RepoOperations {
    return {
      get: () => notImplemented("repos.get"),
      list: () => notImplemented("repos.list"),
      create: () => notImplemented("repos.create"),
      createInOrg: () => notImplemented("repos.createInOrg"),
      delete: () => notImplemented("repos.delete"),
      update: () => notImplemented("repos.update"),
      fork: () => notImplemented("repos.fork"),
      migrate: () => notImplemented("repos.migrate"),
      search: () => notImplemented("repos.search"),
    };
  }

  private buildFileOps(): FileOperations {
    return {
      getContents: () => notImplemented("files.getContents"),
      putFile: () => notImplemented("files.putFile"),
      createFile: () => notImplemented("files.createFile"),
      deleteFile: () => notImplemented("files.deleteFile"),
      getTree: () => notImplemented("files.getTree"),
    };
  }

  private buildBranchOps(): BranchOperations {
    return {
      list: () => notImplemented("branches.list"),
      create: () => notImplemented("branches.create"),
      listProtectionRules: () => notImplemented("branches.listProtectionRules"),
      getProtectionRule: () => notImplemented("branches.getProtectionRule"),
      setProtectionRule: () => notImplemented("branches.setProtectionRule"),
      deleteProtectionRule: () => notImplemented("branches.deleteProtectionRule"),
    };
  }

  private buildCommitOps(): CommitOperations {
    return {
      list: () => notImplemented("commits.list"),
      createStatus: () => notImplemented("commits.createStatus"),
      getCombinedStatus: () => notImplemented("commits.getCombinedStatus"),
      getDiff: async (
        owner: string,
        repo: string,
        sha: string,
      ): Promise<string> => {
        try {
          const projectId = encodeURIComponent(`${owner}/${repo}`);
          const encodedSha = encodeURIComponent(sha);
          const rows = await this.api<Array<{ diff?: string }>>(
            `/projects/${projectId}/repository/commits/${encodedSha}/diff?unidiff=true`,
          );
          if (!Array.isArray(rows) || rows.length === 0) return "";
          return rows
            .map(r => (typeof r.diff === "string" ? r.diff.trimEnd() : ""))
            .filter(Boolean)
            .join("\n\n");
        } catch {
          return "";
        }
      },
    };
  }

  private buildReviewOps(): ReviewOperations {
    return {
      listReviews: () => notImplemented("reviews.listReviews"),
      listComments: () => notImplemented("reviews.listComments"),
      createComment: () => notImplemented("reviews.createComment"),
      createInlineComment: () => notImplemented("reviews.createInlineComment"),
      submitReview: () => notImplemented("reviews.submitReview"),
      requestReviewers: () => notImplemented("reviews.requestReviewers"),
      resolveComment: () => notImplemented("reviews.resolveComment"),
      unresolveComment: () => notImplemented("reviews.unresolveComment"),
    };
  }

  private buildCIOps(): CIOperations {
    return {
      getJobLogs: () => notImplemented("ci.getJobLogs"),
      listArtifacts: () => notImplemented("ci.listArtifacts"),
      downloadArtifact: () => notImplemented("ci.downloadArtifact"),
      getWorkflowTemplate: () => null,
    };
  }

  private buildSecretOps(): RepoSecretOperations {
    return {
      list: () => notImplemented("secrets.list"),
      set: () => notImplemented("secrets.set"),
      delete: () => notImplemented("secrets.delete"),
    };
  }

  private buildOrgOps(): OrgOperations {
    return {
      list: () => notImplemented("orgs.list"),
      create: () => notImplemented("orgs.create"),
      delete: () => notImplemented("orgs.delete"),
      listMembers: () => notImplemented("orgs.listMembers"),
      addMember: () => notImplemented("orgs.addMember"),
      removeMember: () => notImplemented("orgs.removeMember"),
      secrets: {
        list: () => notImplemented("orgs.secrets.list"),
        set: () => notImplemented("orgs.secrets.set"),
        delete: () => notImplemented("orgs.secrets.delete"),
      },
    };
  }

  private buildMirrorOps(): MirrorOperations {
    return {
      setupPushMirror: () => notImplemented("mirrors.setupPushMirror"),
      setupPullMirror: () => notImplemented("mirrors.setupPullMirror"),
      sync: () => notImplemented("mirrors.sync"),
      removePushMirror: () => notImplemented("mirrors.removePushMirror"),
      resolveConflict: () => notImplemented("mirrors.resolveConflict"),
    };
  }

  private buildAuthOps(): AuthOperations {
    return {
      getAuthenticatedUser: () => notImplemented("auth.getAuthenticatedUser"),
    };
  }

  private buildWebhookOps(): WebhookOperations {
    const secret = this.webhookSecret;
    return {
      eventTypeHeader: "X-Gitlab-Event",
      signatureHeader: "X-Gitlab-Token",

      verifySignature(_payload: string | Buffer, signature: string | null): boolean {
        if (!secret) return true;
        if (!signature) return false;
        if (secret.length !== signature.length) return false;
        return timingSafeEqual(Buffer.from(secret), Buffer.from(signature));
      },

      parseEvent: () => notImplemented("webhooks.parseEvent"),
    };
  }
}

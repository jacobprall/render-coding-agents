/**
 * ForgeProvider — the universal interface for git forge operations.
 *
 * Forgejo, GitHub, and GitLab each implement this interface, mapping
 * their native APIs into the normalized types from ./types.ts.
 *
 * Consumers (API routes, agent tools, UI) program against this interface,
 * never against a specific forge client.
 */

import type {
  ForgeRepo,
  ForgeBranch,
  ForgePullRequest,
  ForgeFileContent,
  ForgeCommit,
  ForgeReview,
  ForgeComment,
  ForgeUser,
  ForgeOrg,
  ForgeOrgMember,
  ForgeArtifact,
  ForgeCommitStatus,
  ForgeCombinedStatus,
  ForgeTokenResult,
  ForgeWebhookEvent,
  ForgeWorkflowTemplate,
  MirrorConfig,
  MirrorSyncResult,
  MirrorConflictResult,
  BranchProtectionRule,
  CreateRepoParams,
  CreatePRParams,
  PutFileParams,
  DeleteFileParams,
  MigrateRepoParams,
  InlineCommentParams,
  ReviewEvent,
  MergeMethod,
  ConflictStrategy,
} from "./types";

// ─── Capability Interfaces ───────────────────────────────────────────────────

export interface RepoOperations {
  get(owner: string, repo: string): Promise<ForgeRepo>;
  list(username?: string): Promise<ForgeRepo[]>;
  create(params: CreateRepoParams): Promise<ForgeRepo>;
  createInOrg(org: string, params: CreateRepoParams): Promise<ForgeRepo>;
  delete(owner: string, repo: string): Promise<void>;
  update(owner: string, repo: string, patch: Record<string, unknown>): Promise<ForgeRepo>;
  fork(owner: string, repo: string, name?: string): Promise<ForgeRepo>;
  migrate(params: MigrateRepoParams): Promise<ForgeRepo>;
  search(query: string, limit?: number): Promise<ForgeRepo[]>;
}

export interface FileOperations {
  getContents(owner: string, repo: string, path: string, ref?: string): Promise<ForgeFileContent | ForgeFileContent[]>;
  putFile(owner: string, repo: string, path: string, params: PutFileParams): Promise<ForgeFileContent>;
  createFile(owner: string, repo: string, path: string, params: { content: string; message: string; branch?: string }): Promise<ForgeFileContent>;
  deleteFile(owner: string, repo: string, path: string, params: DeleteFileParams): Promise<void>;
  getTree(owner: string, repo: string, sha: string, recursive?: boolean): Promise<Array<{ path: string; type: string; sha: string; size?: number }>>;
}

export interface BranchOperations {
  list(owner: string, repo: string): Promise<ForgeBranch[]>;
  create(owner: string, repo: string, branchName: string, fromBranch: string): Promise<ForgeBranch>;
  listProtectionRules(owner: string, repo: string): Promise<BranchProtectionRule[]>;
  getProtectionRule(owner: string, repo: string, branch: string): Promise<BranchProtectionRule | null>;
  setProtectionRule(owner: string, repo: string, rule: Partial<BranchProtectionRule> & { pattern: string }): Promise<BranchProtectionRule>;
  deleteProtectionRule(owner: string, repo: string, ruleNameOrPattern: string): Promise<void>;
}

export interface CommitOperations {
  list(owner: string, repo: string, opts?: { sha?: string; limit?: number }): Promise<ForgeCommit[]>;
  createStatus(owner: string, repo: string, sha: string, status: ForgeCommitStatus): Promise<void>;
  getCombinedStatus(owner: string, repo: string, ref: string): Promise<ForgeCombinedStatus>;
  getDiff(owner: string, repo: string, sha: string): Promise<string>;
}

export interface PullRequestOperations {
  list(owner: string, repo: string, state?: "open" | "closed" | "all"): Promise<ForgePullRequest[]>;
  get(owner: string, repo: string, number: number): Promise<ForgePullRequest>;
  create(params: CreatePRParams): Promise<ForgePullRequest>;
  update(owner: string, repo: string, number: number, patch: { state?: "open" | "closed"; title?: string }): Promise<ForgePullRequest>;
  merge(owner: string, repo: string, number: number, method?: MergeMethod): Promise<void>;
  diff(owner: string, repo: string, number: number): Promise<string>;
}

export interface ReviewOperations {
  listReviews(owner: string, repo: string, prNumber: number): Promise<ForgeReview[]>;
  listComments(owner: string, repo: string, prNumber: number): Promise<ForgeComment[]>;
  createComment(owner: string, repo: string, issueNumber: number, body: string): Promise<ForgeComment>;
  createInlineComment(owner: string, repo: string, prNumber: number, params: InlineCommentParams): Promise<ForgeComment>;
  submitReview(owner: string, repo: string, prNumber: number, event: ReviewEvent, body?: string, comments?: InlineCommentParams[]): Promise<ForgeReview>;
  requestReviewers(owner: string, repo: string, prNumber: number, reviewers: string[]): Promise<void>;
  resolveComment(owner: string, repo: string, commentId: number | string): Promise<void>;
  unresolveComment(owner: string, repo: string, commentId: number | string): Promise<void>;
}

export interface CIOperations {
  getJobLogs(owner: string, repo: string, jobId: string | number): Promise<string>;
  listArtifacts(owner: string, repo: string, runId: string | number): Promise<ForgeArtifact[]>;
  downloadArtifact(owner: string, repo: string, artifactId: string | number): Promise<ArrayBuffer>;
  getWorkflowTemplate(language: string): ForgeWorkflowTemplate | null;
}

export interface RepoSecretOperations {
  list(owner: string, repo: string): Promise<string[]>;
  set(owner: string, repo: string, name: string, value: string): Promise<void>;
  delete(owner: string, repo: string, name: string): Promise<void>;
}

export interface OrgSecretOperations {
  list(org: string): Promise<string[]>;
  set(org: string, name: string, value: string): Promise<void>;
  delete(org: string, name: string): Promise<void>;
}

export interface OrgOperations {
  list(): Promise<ForgeOrg[]>;
  create(name: string, opts?: { fullName?: string; description?: string }): Promise<ForgeOrg>;
  delete(orgName: string): Promise<void>;
  listMembers(orgName: string): Promise<ForgeOrgMember[]>;
  addMember(orgName: string, username: string): Promise<void>;
  removeMember(orgName: string, username: string): Promise<void>;
  secrets: OrgSecretOperations;
}

export interface MirrorOperations {
  setupPushMirror(owner: string, repo: string, config: MirrorConfig): Promise<void>;
  setupPullMirror(owner: string, repo: string, config: MirrorConfig): Promise<void>;
  sync(owner: string, repo: string): Promise<MirrorSyncResult>;
  removePushMirror(owner: string, repo: string, remoteUrl: string): Promise<void>;
  resolveConflict(owner: string, repo: string, strategy: ConflictStrategy): Promise<MirrorConflictResult>;
}

export interface AuthOperations {
  getAuthenticatedUser(): Promise<ForgeUser>;
  /**
   * Create an API token for a user. Used for dev login and service accounts.
   * Not all providers support this (GitHub uses OAuth apps or PATs).
   */
  createToken?(username: string, password: string, tokenName: string): Promise<ForgeTokenResult>;
  /**
   * Exchange an OAuth authorization code for an access token.
   */
  exchangeOAuthCode?(code: string, redirectUri: string): Promise<ForgeTokenResult>;
  /**
   * Build the OAuth authorization URL for this provider.
   */
  getOAuthAuthorizeUrl?(redirectUri: string, state: string, scopes?: string[]): string;
}

export interface WebhookOperations {
  /**
   * Verify webhook signature. Returns true if valid (or if verification is disabled).
   */
  verifySignature(payload: string | Buffer, signature: string | null): boolean;
  /**
   * Parse a raw webhook request into a normalized event.
   */
  parseEvent(headers: Record<string, string | undefined>, body: unknown): ForgeWebhookEvent;
  /**
   * Get the header name this provider uses for the event type.
   */
  eventTypeHeader: string;
  /**
   * Get the header name this provider uses for the signature.
   */
  signatureHeader: string;
}

export interface GitOperations {
  /**
   * Clone URL with embedded auth token for the agent.
   */
  authenticatedCloneUrl(owner: string, repo: string): string;
  /**
   * Clean clone URL (no auth) for display.
   */
  plainCloneUrl(owner: string, repo: string): string;
}

// ─── The Provider ────────────────────────────────────────────────────────────

export type ForgeProviderType = "github" | "gitlab";

export interface ForgeProvider {
  readonly type: ForgeProviderType;
  readonly label: string;
  readonly baseUrl: string;

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
}

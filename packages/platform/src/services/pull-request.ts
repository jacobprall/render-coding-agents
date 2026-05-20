import { ValidationError } from "@coding-agents/shared";
import type { AuthContext } from "../interfaces/auth";
import { getForgeProviderForAuth } from "../forge/factory";
import type {
  ForgePullRequest,
  ForgeComment,
  ForgeReview,
  ReviewEvent,
  MergeMethod,
  InlineCommentParams,
} from "../forge/types";

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

export interface UpdatePullRequestParams {
  state?: "open" | "closed";
  title?: string;
}

export interface CreateCommentParams {
  body: string;
  /** File path for inline comments; omit for regular issue comments. */
  path?: string;
  newLine?: number;
  oldLine?: number;
}

export interface SubmitReviewParams {
  event: ReviewEvent;
  body?: string;
  comments?: InlineCommentParams[];
}

export interface CreatePullRequestParams {
  title: string;
  body?: string;
  head: string;
  base: string;
}

// ---------------------------------------------------------------------------
// PullRequestService
// ---------------------------------------------------------------------------

export class PullRequestService {
  // -------------------------------------------------------------------------
  // updatePullRequest — PATCH /api/repos/[owner]/[repo]/pulls/[number]
  // -------------------------------------------------------------------------

  async updatePullRequest(
    auth: AuthContext,
    owner: string,
    repo: string,
    number: number,
    params: UpdatePullRequestParams,
  ): Promise<ForgePullRequest> {
    const patch: { state?: "open" | "closed"; title?: string } = {};
    if (params.state === "open" || params.state === "closed") {
      patch.state = params.state;
    }
    if (typeof params.title === "string" && params.title.trim().length > 0) {
      patch.title = params.title.trim();
    }
    if (Object.keys(patch).length === 0) {
      throw new ValidationError("No valid patch fields (state | title)");
    }
    const forge = getForgeProviderForAuth(auth);
    return forge.pulls.update(owner, repo, number, patch);
  }

  // -------------------------------------------------------------------------
  // mergePullRequest — POST /api/repos/[owner]/[repo]/pulls/[number]/merge
  //                    & mergePullRequestAction server action
  // -------------------------------------------------------------------------

  async mergePullRequest(
    auth: AuthContext,
    owner: string,
    repo: string,
    number: number,
    method?: MergeMethod,
  ): Promise<void> {
    const forge = getForgeProviderForAuth(auth);
    await forge.pulls.merge(owner, repo, number, method ?? "merge");
  }

  // -------------------------------------------------------------------------
  // listComments — GET /api/repos/[owner]/[repo]/pulls/[number]/comments
  // -------------------------------------------------------------------------

  async listComments(
    auth: AuthContext,
    owner: string,
    repo: string,
    number: number,
  ): Promise<ForgeComment[]> {
    const forge = getForgeProviderForAuth(auth);
    return forge.reviews.listComments(owner, repo, number);
  }

  // -------------------------------------------------------------------------
  // createComment — POST /api/repos/[owner]/[repo]/pulls/[number]/comments
  // -------------------------------------------------------------------------

  async createComment(
    auth: AuthContext,
    owner: string,
    repo: string,
    number: number,
    params: CreateCommentParams,
  ): Promise<ForgeComment> {
    const text = params.body.trim();
    if (!text) {
      throw new ValidationError("Comment body is required");
    }
    const forge = getForgeProviderForAuth(auth);
    if (params.path) {
      return forge.reviews.createInlineComment(owner, repo, number, {
        body: text,
        path: params.path,
        newLine: params.newLine,
        oldLine: params.oldLine,
      });
    }
    return forge.reviews.createComment(owner, repo, number, text);
  }

  // -------------------------------------------------------------------------
  // listReviews — GET /api/repos/[owner]/[repo]/pulls/[number]/reviews
  // -------------------------------------------------------------------------

  async listReviews(
    auth: AuthContext,
    owner: string,
    repo: string,
    number: number,
  ): Promise<ForgeReview[]> {
    const forge = getForgeProviderForAuth(auth);
    return forge.reviews.listReviews(owner, repo, number);
  }

  // -------------------------------------------------------------------------
  // submitReview — POST /api/repos/[owner]/[repo]/pulls/[number]/reviews
  // -------------------------------------------------------------------------

  async submitReview(
    auth: AuthContext,
    owner: string,
    repo: string,
    number: number,
    params: SubmitReviewParams,
  ): Promise<ForgeReview> {
    const forge = getForgeProviderForAuth(auth);
    return forge.reviews.submitReview(
      owner,
      repo,
      number,
      params.event,
      params.body,
      params.comments,
    );
  }

  // -------------------------------------------------------------------------
  // resolveComment — POST /api/repos/[owner]/[repo]/pulls/[number]/comments/[commentId]/resolve
  // -------------------------------------------------------------------------

  async resolveComment(
    auth: AuthContext,
    owner: string,
    repo: string,
    commentId: number,
    unresolve?: boolean,
  ): Promise<{ resolved: boolean }> {
    const forge = getForgeProviderForAuth(auth);
    if (unresolve) {
      await forge.reviews.unresolveComment(owner, repo, commentId);
    } else {
      await forge.reviews.resolveComment(owner, repo, commentId);
    }
    return { resolved: !unresolve };
  }

  // -------------------------------------------------------------------------
  // createPullRequest — createPullRequestAction server action
  // -------------------------------------------------------------------------

  async createPullRequest(
    auth: AuthContext,
    owner: string,
    repo: string,
    params: CreatePullRequestParams,
  ): Promise<{ number: number }> {
    if (!params.title?.trim()) {
      throw new ValidationError("title is required");
    }
    if (!params.head?.trim() || !params.base?.trim()) {
      throw new ValidationError("head and base branches are required");
    }
    const forge = getForgeProviderForAuth(auth);
    const pr = await forge.pulls.create({
      owner,
      repo,
      title: params.title.trim(),
      body: params.body,
      head: params.head,
      base: params.base,
    });
    return { number: pr.number };
  }
}

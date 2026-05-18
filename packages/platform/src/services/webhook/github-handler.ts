import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { mirrors, sessions } from "@openforge/db";
import { logger, ValidationError } from "@openforge/shared";
import type { WebhookDeps } from "./shared";

// ---------------------------------------------------------------------------
// GitHubWebhookHandler
// ---------------------------------------------------------------------------

export class GitHubWebhookHandler {
  constructor(private deps: WebhookDeps) {}

  /**
   * Verify GitHub HMAC signature and process comment events that correspond
   * to mirrored repositories, enqueueing agent session trigger jobs.
   */
  async handleGithubWebhook(rawBody: string, signature: string | null): Promise<void> {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    // If no secret is configured, allow all webhooks (useful for local dev /
    // open deployments). Log a warning so operators are aware.
    if (!secret) {
      logger.warn(
        "GITHUB_WEBHOOK_SECRET not configured — skipping signature verification",
        {},
      );
      return;
    }

    const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;

    if (
      !signature ||
      signature.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    ) {
      throw new ValidationError("Invalid GitHub webhook signature");
    }
  }

  /**
   * Process a pre-verified GitHub webhook event and body.
   */
  async handleGithubEvent(event: string | null, rawBody: string): Promise<void> {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      logger.warn("github webhook: invalid JSON", {});
      return;
    }

    const repo = payload.repository as Record<string, unknown> | undefined;
    const repoFullName = typeof repo?.full_name === "string" ? repo.full_name : "";

    logger.info("github webhook received", {
      event: event ?? "",
      repo: repoFullName,
      action: typeof payload.action === "string" ? payload.action : "",
    });

    if (event === "pull_request_review_comment" || event === "issue_comment") {
      await this.handleGithubCommentEvent(event, payload, repoFullName);
    }
  }

  // -------------------------------------------------------------------------
  // Private event handlers
  // -------------------------------------------------------------------------

  private async handleGithubCommentEvent(
    event: string,
    payload: Record<string, unknown>,
    repoFullNameStr: string,
  ): Promise<void> {
    const { db, ciService } = this.deps;
    if (!repoFullNameStr) return;

    const action = payload.action as string | undefined;
    if (action !== "created") return;

    const comment = payload.comment as Record<string, unknown> | undefined;
    const commentUser = comment?.user as Record<string, unknown> | undefined;
    const commentAuthor =
      typeof commentUser?.login === "string" ? commentUser.login : "";

    logger.info("github webhook comment event", {
      repo: repoFullNameStr,
      event,
      commentAuthor,
    });

    const remoteUrl = `https://github.com/${repoFullNameStr}.git`;
    const matchingMirrors = await db
      .select()
      .from(mirrors)
      .where(eq(mirrors.remoteRepoUrl, remoteUrl));

    if (matchingMirrors.length === 0) return;

    const body = typeof comment?.body === "string" ? comment.body : "";

    const issue = payload.issue as Record<string, unknown> | undefined;
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    const prNumber = pr?.number ?? issue?.number;

    const path =
      event === "pull_request_review_comment" && typeof comment?.path === "string"
        ? comment.path
        : "";

    for (const mirror of matchingMirrors) {
      if (!mirror.sessionId) continue;

      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, mirror.sessionId))
        .limit(1);

      if (!session || session.status !== "running") continue;

      const fixContext = [
        `GitHub ${event} on ${repoFullNameStr}${prNumber ? ` PR #${prNumber}` : ""}.`,
        path ? `File: ${path}` : "",
        body ? `Comment:\n${body}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      await ciService
        .enqueueSessionTriggerJob({
          sessionRow: session,
          userId: session.userId,
          trigger: "review_comment",
          fixContext,
        })
        .catch((err) =>
          logger.errorWithCause(err, "enqueue github webhook job failed", {
            sessionId: session.id,
          }),
        );
    }
  }
}

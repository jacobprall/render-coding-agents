import type { InboundEvent, InboundRoute, RouteAction } from "./types";

// ---------------------------------------------------------------------------
// Default route table
//
// Order matters — first match wins. Rules are designed to be independent and
// non-overlapping in the common case, but explicit ordering avoids surprises.
// ---------------------------------------------------------------------------

export const DEFAULT_ROUTES: InboundRoute[] = [
  // -------------------------------------------------------------------------
  // PR synchronize — always coalesce (cancel old runs) before triggering
  // -------------------------------------------------------------------------
  {
    name: "pr_synchronize.coalesce",
    match: (e: InboundEvent) => e.kind === "pr_synchronize" && !!e.repo && !!e.pr,
    handle: (e: InboundEvent): RouteAction => ({
      type: "coalesce",
      repo: e.repo!.fullName,
      prNumber: e.pr!.number,
      then: {
        type: "trigger_session",
        trigger: "review_comment",
        fixContext: [
          `PR #${e.pr!.number} in ${e.repo!.fullName} was updated with new commits.`,
          e.pr?.headSha ? `New head commit: ${e.pr.headSha}` : "",
          "Continue reviewing and addressing the latest changes.",
        ]
          .filter(Boolean)
          .join("\n"),
        sessionMatcher: {
          by: "repo_pr",
          repo: e.repo!.fullName,
          prNumber: e.pr!.number,
        },
      },
    }),
  },

  // -------------------------------------------------------------------------
  // Review comment — someone commented on a PR
  // -------------------------------------------------------------------------
  {
    name: "review_comment",
    match: (e: InboundEvent) => e.kind === "review_comment" && !!e.repo,
    handle: (e: InboundEvent): RouteAction => {
      const payload = e.payload as Record<string, unknown>;
      const prNumber = e.pr?.number;

      const contextParts: string[] = [
        `New review comment on ${e.repo!.fullName}${prNumber ? ` PR #${prNumber}` : ""}.`,
      ];

      const path =
        typeof payload.path === "string" && payload.path
          ? payload.path
          : undefined;
      const body =
        typeof payload.body === "string" && payload.body ? payload.body : undefined;
      if (path) contextParts.push(`File: ${path}`);
      if (body) contextParts.push(`Comment:\n${body}`);

      const matcher = prNumber
        ? { by: "repo_pr" as const, repo: e.repo!.fullName, prNumber }
        : { by: "repo_branch" as const, repo: e.repo!.fullName, branch: "" };

      return {
        type: "trigger_session",
        trigger: "review_comment",
        fixContext: contextParts.join("\n\n"),
        sessionMatcher: matcher,
      };
    },
  },

  // -------------------------------------------------------------------------
  // PR opened — start or continue work on a new PR
  // -------------------------------------------------------------------------
  {
    name: "pr_opened",
    match: (e: InboundEvent) => e.kind === "pr_opened" && !!e.repo && !!e.pr,
    handle: (e: InboundEvent): RouteAction => ({
      type: "trigger_session",
      trigger: "pr_opened",
      fixContext: `Pull request #${e.pr!.number} was opened in ${e.repo!.fullName}. Review and continue the task as needed.`,
      sessionMatcher: {
        by: "repo_pr",
        repo: e.repo!.fullName,
        prNumber: e.pr!.number,
      },
    }),
  },

  // -------------------------------------------------------------------------
  // PR merged — notify the session, transition to deliver phase
  // -------------------------------------------------------------------------
  {
    name: "pr_merged",
    match: (e: InboundEvent) => e.kind === "pr_merged" && !!e.repo && !!e.pr,
    handle: (e: InboundEvent): RouteAction => ({
      type: "trigger_session",
      trigger: "pr_merged",
      fixContext: `Pull request #${e.pr!.number} was merged into ${e.repo!.fullName}. Session can be archived if work is complete.`,
      sessionMatcher: {
        by: "repo_pr",
        repo: e.repo!.fullName,
        prNumber: e.pr!.number,
      },
    }),
  },

  // -------------------------------------------------------------------------
  // CI failure — attempt automated fix
  // -------------------------------------------------------------------------
  {
    name: "ci_failure",
    match: (e: InboundEvent) => e.kind === "ci_failure" && !!e.repo,
    handle: (e: InboundEvent): RouteAction => {
      const payload = e.payload as Record<string, unknown>;
      const workflowName = typeof payload.workflowName === "string" ? payload.workflowName : "unknown";
      const branch = e.pr?.branch ?? (typeof payload.branch === "string" ? payload.branch : undefined);

      return {
        type: "trigger_session",
        trigger: "ci_failure",
        fixContext: `CI workflow "${workflowName}" failed for ${e.repo!.fullName}${branch ? ` on branch ${branch}` : ""}. Review the failures and fix the code.`,
        sessionMatcher: branch
          ? { by: "repo_branch", repo: e.repo!.fullName, branch }
          : { by: "repo_pr", repo: e.repo!.fullName, prNumber: e.pr?.number ?? 0 },
      };
    },
  },

  // -------------------------------------------------------------------------
  // Deploy failure — create a diagnostic session (handled by gateway directly)
  // -------------------------------------------------------------------------
  {
    name: "deploy_failure",
    match: (e: InboundEvent) => e.kind === "deploy_failure",
    handle: (e: InboundEvent): RouteAction => {
      const p = e.payload;
      return {
        type: "create_diagnostic_session",
        serviceId: (p.serviceId as string | undefined) ?? "",
        serviceName: (p.serviceName as string | undefined) ?? "",
        deployId: (p.deployId as string | undefined) ?? "",
        commitId: p.commitId as string | undefined,
        commitMessage: p.commitMessage as string | undefined,
      };
    },
  },

  // -------------------------------------------------------------------------
  // CI success — record, no agent action needed
  // -------------------------------------------------------------------------
  {
    name: "ci_success.ignore",
    match: (e: InboundEvent) => e.kind === "ci_success",
    handle: (): RouteAction => ({ type: "ignore", reason: "ci_success — no agent action needed" }),
  },

  // -------------------------------------------------------------------------
  // PR closed without merge — no action
  // -------------------------------------------------------------------------
  {
    name: "pr_closed.ignore",
    match: (e: InboundEvent) => e.kind === "pr_closed",
    handle: (): RouteAction => ({ type: "ignore", reason: "pr_closed — no agent action" }),
  },

  // -------------------------------------------------------------------------
  // Fallthrough — unknown events are ignored
  // -------------------------------------------------------------------------
  {
    name: "unknown.ignore",
    match: (e: InboundEvent) => e.kind === "unknown",
    handle: (): RouteAction => ({ type: "ignore", reason: "unknown event kind" }),
  },
];

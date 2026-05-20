import { defineTool } from "./define-tool";
import { z } from "zod";
import { withForgeContext } from "./tool-helpers";

const MAX_PR_TITLE_LENGTH = 500;

function sanitizePrTitle(raw: string, fallback: string): string {
  const base = raw.replace(/[\r\n\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  const title = base.length > 0 ? base : fallback;
  return title.length > MAX_PR_TITLE_LENGTH ? title.slice(0, MAX_PR_TITLE_LENGTH) : title;
}

const createPrInputSchema = z.object({
  title: z.string().describe("Pull request title"),
  body: z.string().optional().describe("PR body in Markdown (optional)"),
  base: z.string().optional().describe("Target branch to merge into (defaults to session base branch)"),
});

export function createPullRequestTool() {
  return defineTool({
    description:
      "Create a pull request from the current branch. If the repo is a pull mirror, the PR is created on the upstream provider (e.g. GitHub). Push your branch with the git tool first. Returns the PR URL and number on success.",
    inputSchema: createPrInputSchema,
    execute: withForgeContext(async ({ title, body, base: baseOpt }, ctx) => {
      const { forge, repoOwner, repoName, sessionId, baseBranch, adapter, upstream } = ctx;

      const branchOut = await adapter.git(sessionId, ["branch", "--show-current"]);
      const head = branchOut.stdout.trim();
      if (!head) {
        return { success: false as const, error: "Could not determine current git branch" };
      }

      const base = baseOpt?.trim() || baseBranch;
      if (head === base) {
        return {
          success: false as const,
          error: `Current branch "${head}" is the base branch. Create a feature branch first.`,
        };
      }

      const prTitle = sanitizePrTitle(title, "Update");

      const targetForge = upstream?.forge ?? forge;
      const targetOwner = upstream?.remoteOwner ?? repoOwner;
      const targetRepo = upstream?.remoteRepo ?? repoName;

      const pr = await targetForge.pulls.create({
        owner: targetOwner,
        repo: targetRepo,
        head,
        base,
        title: prTitle,
        body: body?.trim() ?? "",
      });

      await ctx.onPrCreated?.({ prNumber: pr.number, prStatus: "open" });

      return {
        success: true as const,
        number: pr.number,
        url: pr.htmlUrl,
        head,
        base,
        title: prTitle,
        upstream: upstream ? `${upstream.provider}:${targetOwner}/${targetRepo}` : undefined,
      };
    }),
  });
}

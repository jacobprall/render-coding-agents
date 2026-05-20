import { defineTool } from "./define-tool";
import { z } from "zod";
import { withForgeContext } from "./tool-helpers";

export function resolveCommentTool() {
  return defineTool({
    description:
      "Resolve (or unresolve) a PR review comment by its numeric comment ID. Marks a review thread as addressed.",
    inputSchema: z.object({
      comment_id: z.number().int().positive().describe("Review comment ID to resolve"),
      unresolve: z.boolean().optional().describe("Pass true to unresolve instead of resolving"),
    }),
    execute: withForgeContext(async ({ comment_id, unresolve }, ctx) => {
      if (unresolve) {
        await ctx.forge.reviews.unresolveComment(ctx.repoOwner, ctx.repoName, comment_id);
      } else {
        await ctx.forge.reviews.resolveComment(ctx.repoOwner, ctx.repoName, comment_id);
      }
      return { success: true as const, resolved: !unresolve, commentId: comment_id };
    }),
  });
}

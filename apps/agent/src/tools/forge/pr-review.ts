import { defineTool } from "../define-tool";
import { z } from "zod";
import { withForgeContext } from "../tool-helpers";
import { prNumberSchema } from "./schemas";

export function addPrCommentTool() {
  return defineTool({
    description: "Add a general PR comment on the forge (issue comment on the PR).",
    inputSchema: z.object({
      number: prNumberSchema,
      body: z.string().min(1),
    }),
    execute: withForgeContext(async ({ number, body }, ctx) => {
      await ctx.forge.reviews.createComment(ctx.repoOwner, ctx.repoName, number, body);
      return { success: true as const };
    }),
  });
}

export function requestReviewTool() {
  return defineTool({
    description: "Request review from one or more forge users.",
    inputSchema: z.object({
      number: prNumberSchema,
      reviewers: z.array(z.string()).min(1),
    }),
    execute: withForgeContext(async ({ number, reviewers }, ctx) => {
      await ctx.forge.reviews.requestReviewers(ctx.repoOwner, ctx.repoName, number, reviewers);
      return { success: true as const };
    }),
  });
}

export function approvePrTool() {
  return defineTool({
    description: "Submit an approving PR review.",
    inputSchema: z.object({
      number: prNumberSchema,
      body: z.string().optional(),
    }),
    execute: withForgeContext(async ({ number, body }, ctx) => {
      await ctx.forge.reviews.submitReview(ctx.repoOwner, ctx.repoName, number, "approve", body);
      return { success: true as const };
    }),
  });
}

const inlineNoteSchema = z.object({
  path: z.string().min(1),
  body: z.string().min(1),
  old_line_num: z.number().int().positive().optional(),
  new_line_num: z.number().int().positive().optional(),
});

export function reviewPrTool() {
  return defineTool({
    description:
      "Submit a pull request review (COMMENT) on the forge. Optionally attach inline file comments.",
    inputSchema: z.object({
      number: prNumberSchema,
      summary: z.string().min(1).describe("Top-level review comment / summary"),
      inline_comments: z.array(inlineNoteSchema).optional(),
    }),
    execute: withForgeContext(async ({ number, summary, inline_comments }, ctx) => {
      const comments = inline_comments?.map((c) => ({
        body: c.body,
        path: c.path,
        newLine: c.new_line_num,
        oldLine: c.old_line_num,
      }));
      await ctx.forge.reviews.submitReview(
        ctx.repoOwner,
        ctx.repoName,
        number,
        "comment",
        summary,
        comments,
      );
      return { success: true as const, reviewed: number };
    }),
  });
}

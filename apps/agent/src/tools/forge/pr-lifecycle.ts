import { defineTool } from "../define-tool";
import { z } from "zod";
import { withForgeContext } from "../tool-helpers";
import { prNumberSchema } from "./schemas";

const methodSchema = z.enum(["merge", "rebase", "squash"]).optional();

export function mergePrTool() {
  return defineTool({
    description:
      "Merge an open pull request on the forge. Branch protection applies on the server.",
    inputSchema: z.object({
      number: prNumberSchema,
      method: methodSchema.describe("Merge strategy (defaults to merge)"),
    }),
    execute: withForgeContext(async ({ number, method }, ctx) => {
      await ctx.forge.pulls.merge(ctx.repoOwner, ctx.repoName, number, method ?? "merge");
      return { success: true as const, merged: number };
    }),
  });
}

export function closePrTool() {
  return defineTool({
    description: "Close a pull request without merging.",
    inputSchema: z.object({
      number: prNumberSchema,
    }),
    execute: withForgeContext(async ({ number }, ctx) => {
      await ctx.forge.pulls.update(ctx.repoOwner, ctx.repoName, number, { state: "closed" });
      return { success: true as const, closed: number };
    }),
  });
}

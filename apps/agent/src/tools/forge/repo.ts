import { defineTool } from "../define-tool";
import { z } from "zod";
import { withForgeContext } from "../tool-helpers";

export function createRepoTool() {
  return defineTool({
    description:
      "Create a new repository under the authenticated user namespace (requires permissions).",
    inputSchema: z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      private: z.boolean().optional(),
      auto_init: z.boolean().optional(),
      default_branch: z.string().optional(),
    }),
    execute: withForgeContext(async (params, ctx) => {
      const repo = await ctx.forge.repos.create({
        name: params.name,
        description: params.description,
        isPrivate: params.private,
        autoInit: params.auto_init ?? true,
        defaultBranch: params.default_branch ?? "main",
      });
      return { success: true as const, full_name: repo.fullName, clone_url: repo.cloneUrl };
    }),
  });
}

import { defineTool } from "./define-tool";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { sessions } from "@coding-agents/db";
import type { PlatformDb } from "@coding-agents/platform";

const attachRepoInputSchema = z.object({
  repoPath: z
    .string()
    .describe("Repository path in owner/name format (e.g. 'acme/api-server')"),
  branch: z
    .string()
    .optional()
    .describe("Branch to work on. Defaults to the repo's default branch."),
});

export function attachRepoTool(
  db: PlatformDb,
  sessionId: string,
) {
  return defineTool({
    description:
      "Attach a repository to this scratch session. Once attached, your next turn will have the full tool set: git, PRs, deploy, and Render tools. The repo will be cloned automatically.",
    inputSchema: attachRepoInputSchema,
    execute: async ({ repoPath, branch }) => {
      const slashIdx = repoPath.indexOf("/");
      if (slashIdx <= 0 || slashIdx === repoPath.length - 1) {
        return { success: false, error: "repoPath must be in owner/name format" };
      }

      const [row] = await db
        .select({ id: sessions.id, repoPath: sessions.repoPath })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (!row) {
        return { success: false, error: "Session not found" };
      }

      if (row.repoPath) {
        return {
          success: false,
          error: `Session already has a repository attached: ${row.repoPath}. Cannot re-attach.`,
        };
      }

      const resolvedBranch = branch || "main";

      await db
        .update(sessions)
        .set({
          repoPath,
          forgeType: "github",
          branch: resolvedBranch,
          baseBranch: resolvedBranch,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));

      return {
        success: true,
        repoPath,
        branch: resolvedBranch,
        message:
          "Repository attached. On your next turn, the repo will be cloned and you'll have access to git, PR, deploy, and Render tools. Let the user know the repo is now linked.",
      };
    },
  });
}

import { defineTool } from "./define-tool";
import { z } from "zod";
import { getSandboxContext, isForgeAgentContext } from "../context/agent-context";

const gitInputSchema = z.object({
  args: z.array(z.string()).describe("Git command arguments (e.g. ['status'] or ['add', '-A'])"),
});

const GIT_COMMANDS_NEEDING_AUTH = new Set(["push", "fetch", "pull"]);

export function gitTool() {
  return defineTool({
    description:
      "Run a git command in the session workspace. For push/fetch/pull, authentication is handled automatically. Use this instead of bash for git operations.",
    inputSchema: gitInputSchema,
    execute: async ({ args }, { context }) => {
      const { adapter, sessionId } = getSandboxContext(context);

      const subcommand = args[0]?.toLowerCase();
      const needsAuth = subcommand && GIT_COMMANDS_NEEDING_AUTH.has(subcommand);

      if (needsAuth && isForgeAgentContext(context)) {
        const { forge, repoOwner, repoName } = context;
        const authUrl = forge.git.authenticatedCloneUrl(repoOwner, repoName);
        const modifiedArgs = args.map((arg) => (arg === "origin" ? authUrl : arg));
        return await adapter.git(sessionId, modifiedArgs);
      }

      return await adapter.git(sessionId, args);
    },
  });
}

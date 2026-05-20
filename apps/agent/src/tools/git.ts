import { defineTool } from "./define-tool";
import { z } from "zod";
import { getSandboxContext, isForgeAgentContext } from "../context/agent-context";
import { rewriteForSandbox } from "../sandbox-url";

const gitInputSchema = z.object({
  args: z.array(z.string()).describe("Git command arguments (e.g. ['status'] or ['add', '-A'])"),
});

const GIT_COMMANDS_NEEDING_AUTH = new Set(["push", "fetch", "pull"]);

export function gitTool() {
  return defineTool({
    description:
      "Run a git command in the session workspace. For push/fetch/pull, authentication is handled automatically. If the repo is a pull mirror, push targets the upstream provider (e.g. GitHub). Use this instead of bash for git operations.",
    inputSchema: gitInputSchema,
    execute: async ({ args }, { context }) => {
      const { adapter, sessionId } = getSandboxContext(context);

      const subcommand = args[0]?.toLowerCase();
      const needsAuth = subcommand && GIT_COMMANDS_NEEDING_AUTH.has(subcommand);

      if (needsAuth && isForgeAgentContext(context)) {
        const { forge, repoOwner, repoName, upstream } = context;

        if (subcommand === "push" && upstream) {
          const upstreamAuthUrl = upstream.forge.git.authenticatedCloneUrl(
            upstream.remoteOwner,
            upstream.remoteRepo,
          );
          const forgejoPlainUrl = rewriteForSandbox(forge.git.plainCloneUrl(repoOwner, repoName));

          await adapter.git(sessionId, ["remote", "set-url", "origin", upstreamAuthUrl]);
          try {
            return await adapter.git(sessionId, args);
          } finally {
            await adapter.git(sessionId, ["remote", "set-url", "origin", forgejoPlainUrl]).catch(() => {});
          }
        }

        const authUrl = rewriteForSandbox(forge.git.authenticatedCloneUrl(repoOwner, repoName));
        const plainUrl = rewriteForSandbox(forge.git.plainCloneUrl(repoOwner, repoName));

        await adapter.git(sessionId, ["remote", "set-url", "origin", authUrl]);
        try {
          return await adapter.git(sessionId, args);
        } finally {
          await adapter.git(sessionId, ["remote", "set-url", "origin", plainUrl]).catch(() => {});
        }
      }

      return await adapter.git(sessionId, args);
    },
  });
}

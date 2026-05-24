import { defineTool } from "./define-tool";
import { z } from "zod";
import { getSandboxContext } from "../context/agent-context";
import { truncateLargeString, MAX_BASH_STREAM_CHARS } from "./truncation";

const bashInputSchema = z.object({
  command: z.string().describe("The bash command to execute"),
  timeoutMs: z.number().optional().describe("Timeout in milliseconds (default 120000)"),
});

export function bashInvokesRemoteGit(command: string): boolean {
  const segments = command.split(/[|;&]+/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    const gitMatch = trimmed.match(/\bgit\b/);
    if (!gitMatch) continue;

    const afterGit = trimmed.slice(gitMatch.index! + 3).trim();
    const tokens = afterGit.split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token === "push" || token === "fetch" || token === "pull") return true;
      if (token.startsWith("--")) continue;
      if (token.startsWith("-")) {
        if (token === "-c" || token === "--config") i++;
        continue;
      }
      break;
    }
  }
  return false;
}

export function bashTool() {
  return defineTool({
    description:
      "Execute a bash command in the session workspace (repo root). Each invocation starts in the same working directory — `cd` does not persist between calls. Use relative paths. Do not use this for `git push`, `git fetch`, or `git pull` — use the git tool for those so forge authentication is applied.",
    inputSchema: bashInputSchema,
    execute: async ({ command, timeoutMs }, execOptions) => {
      if (bashInvokesRemoteGit(command)) {
        return {
          stdout: "",
          stderr:
            "git push, git fetch, and git pull must be run via the git tool (e.g. args: [\"push\", \"origin\", \"my-branch\"]), not bash. The git tool injects forge credentials automatically.",
          exitCode: 1,
          timedOut: false,
        };
      }
      if (execOptions.abortSignal?.aborted) {
        return { stdout: "", stderr: "Execution interrupted", exitCode: 130, timedOut: false };
      }
      const { adapter, sessionId } = getSandboxContext(execOptions.context);
      const result = await adapter.exec(sessionId, command, timeoutMs);
      const stdout = truncateLargeString(result.stdout, MAX_BASH_STREAM_CHARS);
      const stderr = truncateLargeString(result.stderr, MAX_BASH_STREAM_CHARS);
      return {
        stdout: stdout.value,
        stderr: stderr.value,
        exitCode: result.exitCode,
        ...(stdout.truncated || stderr.truncated
          ? {
              truncated: {
                stdout: stdout.truncated ? stdout.originalLength : undefined,
                stderr: stderr.truncated ? stderr.originalLength : undefined,
                hint: "Output was truncated. Re-run with grep/sed/head/tail to inspect specific ranges.",
              },
            }
          : {}),
      };
    },
  });
}

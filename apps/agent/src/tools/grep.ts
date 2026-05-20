import { defineTool } from "./define-tool";
import { z } from "zod";
import { getSandboxContext } from "../context/agent-context";
import { MAX_GREP_MATCHES, MAX_GREP_MATCH_LINE_CHARS } from "./truncation";

const grepInputSchema = z.object({
  pattern: z.string().describe("The regex pattern to search for"),
  path: z.string().optional().describe("Optional directory or file to search in"),
});

export function grepTool() {
  return defineTool({
    description: "Search for a pattern in files using ripgrep.",
    inputSchema: grepInputSchema,
    execute: async ({ pattern, path }, { context }) => {
      const { adapter, sessionId } = getSandboxContext(context);
      const command = path
        ? `rg --json ${JSON.stringify(pattern)} ${JSON.stringify(path)}`
        : `rg --json ${JSON.stringify(pattern)}`;
      const result = await adapter.exec(sessionId, command);

      const lines = result.stdout.split("\n").filter(Boolean);
      const matches: Array<{ file: string; line: number; content: string }> = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "match") {
            const content = parsed.data?.lines?.text ?? "";
            matches.push({
              file: parsed.data?.path?.text ?? "",
              line: parsed.data?.line_number ?? 0,
              content:
                content.length > MAX_GREP_MATCH_LINE_CHARS
                  ? `${content.slice(0, MAX_GREP_MATCH_LINE_CHARS)}…`
                  : content,
            });
          }
        } catch {}
      }

      const totalMatches = matches.length;
      const limited = matches.slice(0, MAX_GREP_MATCHES);
      return {
        matches: limited,
        ...(totalMatches > MAX_GREP_MATCHES
          ? {
              truncated: {
                shown: limited.length,
                total: totalMatches,
                hint: "Result list was truncated. Narrow the pattern or scope.",
              },
            }
          : {}),
      };
    },
  });
}

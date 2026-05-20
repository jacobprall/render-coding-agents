import { defineTool } from "./define-tool";
import { z } from "zod";
import { getSandboxContext } from "../context/agent-context";
import { truncateLargeString, MAX_READ_FILE_CHARS } from "./truncation";

const readFileInputSchema = z.object({
  path: z.string().describe("The file path relative to the workspace root"),
});

export function readFileTool() {
  return defineTool({
    description: "Read the contents of a file in the session workspace.",
    inputSchema: readFileInputSchema,
    execute: async ({ path }, { context }) => {
      const { adapter, sessionId } = getSandboxContext(context);
      try {
        const file = await adapter.readFile(sessionId, path);
        if (!file.exists) {
          return { content: "", exists: false as const };
        }
        const truncated = truncateLargeString(file.content, MAX_READ_FILE_CHARS);
        return {
          content: truncated.value,
          exists: true as const,
          ...(truncated.truncated
            ? {
                truncated: {
                  originalLength: truncated.originalLength,
                  hint: "File was truncated. Use bash with sed/awk to read specific line ranges.",
                },
              }
            : {}),
        };
      } catch {
        return { content: "", exists: false as const };
      }
    },
  });
}

import { defineTool } from "./define-tool";
import { z } from "zod";
import { getSandboxContext } from "../context/agent-context";

const globInputSchema = z.object({
  pattern: z.string().describe("The glob pattern (e.g. '**/*.ts')"),
});

export function globTool() {
  return defineTool({
    description: "Find files matching a glob pattern in the session workspace.",
    inputSchema: globInputSchema,
    execute: async ({ pattern }, { context }) => {
      const { adapter, sessionId } = getSandboxContext(context);
      const { files, truncated } = await adapter.glob(sessionId, pattern);
      return { files, ...(truncated ? { truncated } : {}) };
    },
  });
}

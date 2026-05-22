import { z } from "zod";
import { formatToolOutputForLlm } from "../lib/secret-redaction";
import { defineTool } from "./define-tool";

const getToolResultInputSchema = z.object({
  tool_call_id: z
    .string()
    .describe("The tool_call_id of the result to retrieve"),
});

export function getToolResultTool(
  resultStore: Map<string, string>,
  secrets?: Record<string, string>,
) {
  return defineTool({
    description:
      "Retrieve the full content of a previously compacted tool result. Use when you need to re-examine output from an earlier step.",
    inputSchema: getToolResultInputSchema,
    execute: async ({ tool_call_id }) => {
      const stored = resultStore.get(tool_call_id);
      if (!stored) {
        return { error: `No stored result for tool_call_id "${tool_call_id}". It may not have been compacted or the ID is incorrect.` };
      }
      return formatToolOutputForLlm(stored, secrets);
    },
  });
}

import { defineTool } from "./define-tool";
import { z } from "zod";
import { getSandboxContext } from "../context/agent-context";
import { toErrorResult } from "./tool-helpers";
import { notifyFileChanged } from "./file-events";

const editFileInputSchema = z.object({
  path: z.string().describe("Workspace-relative path to the file"),
  oldString: z.string().describe("Exact text to replace"),
  newString: z.string().describe("Replacement text"),
  replaceAll: z.boolean().optional().describe("Replace all occurrences. Default: false"),
});

export function editFileTool() {
  return defineTool({
    description: `Perform exact string replacement in a file. Read the file first, then supply the exact text to replace (including whitespace). Use replaceAll: true to replace every occurrence.`,
    inputSchema: editFileInputSchema,
    execute: async ({ path: filePath, oldString, newString, replaceAll = false }, { context }) => {
      const { adapter, sessionId } = getSandboxContext(context);

      if (oldString === newString) {
        return { success: false, error: "oldString and newString must differ" };
      }

      try {
        const file = await adapter.readFile(sessionId, filePath);
        if (!file.exists) {
          return { success: false, error: "File not found" };
        }
        const content = file.content;
        if (!content.includes(oldString)) {
          return { success: false, error: "oldString not found in file" };
        }

        const occurrences = content.split(oldString).length - 1;
        if (occurrences > 1 && !replaceAll) {
          return {
            success: false,
            error: `oldString found ${occurrences} times. Use replaceAll: true or add more context.`,
          };
        }

        const newContent = replaceAll
          ? content.replaceAll(oldString, newString)
          : content.replace(oldString, newString);

        await adapter.writeFile(sessionId, filePath, newContent);
        await notifyFileChanged(context, filePath, content, newContent);
        return { success: true, path: filePath, replacements: replaceAll ? occurrences : 1 };
      } catch (err) {
        return toErrorResult(err);
      }
    },
  });
}

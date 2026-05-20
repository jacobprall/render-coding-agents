import { defineTool } from "./define-tool";
import { z } from "zod";
import type { StreamEvent } from "../types";

export const submitSpecInputSchema = z.object({
  goal: z.string(),
  approach: z.string(),
  filesToModify: z.array(z.string()).optional(),
  filesToCreate: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  outOfScope: z.array(z.string()).optional(),
  verificationPlan: z.string(),
  estimatedComplexity: z.enum(["trivial", "small", "medium", "large"]).optional(),
});

export type SubmitSpecInput = z.infer<typeof submitSpecInputSchema>;

export function submitSpecTool(
  publish: (event: StreamEvent) => Promise<void>,
  persistSpec: (spec: SubmitSpecInput) => Promise<void>,
) {
  return defineTool({
    description:
      "Submit a structured implementation specification for human approval before coding.",
    inputSchema: submitSpecInputSchema,
    execute: async (spec) => {
      await publish({ type: "spec", spec });

      await persistSpec(spec);

      return { success: true as const };
    },
  });
}

import { defineTool } from "../define-tool";
import { z } from "zod";
import { withForgeContext } from "../tool-helpers";
import { truncateLargeString } from "../truncation";
import { prNumberSchema } from "./schemas";

const DEFAULT_MAX_CHARS = 120_000;
const MIN_MAX_CHARS_LOG = 1_000;
const MIN_MAX_CHARS_DIFF = 2_000;
const ABS_MAX_CHARS = 500_000;

function clampMaxChars(value: number | undefined, floor: number): number {
  return Math.min(Math.max(value ?? DEFAULT_MAX_CHARS, floor), ABS_MAX_CHARS);
}

export function readBuildLogTool() {
  return defineTool({
    description: "Fetch plaintext CI job logs for diagnosing failures.",
    inputSchema: z.object({
      job_id: z.union([z.string(), z.number()]),
      max_chars: z.number().optional(),
    }),
    execute: withForgeContext(async ({ job_id, max_chars }, ctx) => {
      const raw = await ctx.forge.ci.getJobLogs(ctx.repoOwner, ctx.repoName, job_id);
      const cap = clampMaxChars(max_chars, MIN_MAX_CHARS_LOG);
      const result = truncateLargeString(raw, cap, "tail");
      return { success: true as const, log: result.value, truncated: result.truncated };
    }),
  });
}

export function pullRequestDiffTool() {
  return defineTool({
    description:
      "Fetch unified diff text for an open PR (large results are truncated). Use before posting a review.",
    inputSchema: z.object({
      number: prNumberSchema,
      max_chars: z.number().optional(),
    }),
    execute: withForgeContext(async ({ number, max_chars }, ctx) => {
      const raw = await ctx.forge.pulls.diff(ctx.repoOwner, ctx.repoName, number);
      const cap = clampMaxChars(max_chars, MIN_MAX_CHARS_DIFF);
      const result = truncateLargeString(raw, cap, "head");
      return {
        success: true as const,
        diff: result.value,
        total_chars: raw.length,
        truncated: result.truncated,
      };
    }),
  });
}

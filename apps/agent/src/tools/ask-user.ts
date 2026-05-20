import type Redis from "ioredis";
import { defineTool } from "./define-tool";
import { z } from "zod";
import { nanoid } from "nanoid";
import { askUserReplyQueueKey } from "@openforge/platform";
import { abortableBlpop } from "../lib/abortable-blpop";

const askUserInputSchema = z.object({
  question: z.string().describe("The question to ask the user"),
  options: z.array(z.string()).optional().describe("Optional list of answer choices"),
});

export function askUserQuestionTool(
  runId: string,
  duplicateRedis: () => Redis,
  publishFn: (event: Record<string, unknown>) => Promise<void>,
) {
  const timeoutSec = Math.min(
    Math.max(Number(process.env.ASK_USER_TIMEOUT_SEC ?? "900"), 1),
    86_400,
  );

  return defineTool({
    description: "Ask the user a clarifying question and wait for their answer.",
    inputSchema: askUserInputSchema,
    execute: async ({ question, options }, execOptions) => {
      const toolCallId = execOptions.toolCallId ?? nanoid();
      await publishFn({ type: "ask_user", question, options, toolCallId });

      const key = askUserReplyQueueKey(runId, toolCallId);
      const blocker = duplicateRedis();

      try {
        const popped = await abortableBlpop(blocker, key, timeoutSec, execOptions.abortSignal);
        if (!popped?.[1]) {
          return { timedOut: true as const, answer: "No answer received within the allowed time." };
        }

        let message: string;
        try {
          const parsed = JSON.parse(popped[1]) as { message?: string };
          message = typeof parsed.message === "string" && parsed.message.length > 0
            ? parsed.message
            : popped[1];
        } catch {
          message = popped[1];
        }
        return { timedOut: false as const, answer: message };
      } finally {
        void blocker.quit().catch(() => {});
      }
    },
  });
}

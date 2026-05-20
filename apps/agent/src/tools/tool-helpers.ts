import type { ToolExecutionOptions } from "./define-tool";
import { isForgeAgentContext, type ForgeAgentContext } from "../context/agent-context";

export function toErrorResult(e: unknown): { success: false; error: string } {
  return { success: false as const, error: e instanceof Error ? e.message : String(e) };
}

/**
 * Wraps a forge-tool execute function with context validation and
 * error normalisation. The inner `fn` receives a guaranteed
 * `ForgeAgentContext`; any thrown error is caught and returned as
 * `{ success: false, error }`.
 */
export function withForgeContext<TInput, TResult>(
  fn: (input: TInput, ctx: ForgeAgentContext) => Promise<TResult>,
) {
  return async (
    input: TInput,
    options: ToolExecutionOptions,
  ): Promise<TResult | { success: false; error: string }> => {
    if (!isForgeAgentContext(options.context)) {
      return { success: false as const, error: "Agent context not available" };
    }
    try {
      return await fn(input, options.context);
    } catch (e) {
      return toErrorResult(e);
    }
  };
}

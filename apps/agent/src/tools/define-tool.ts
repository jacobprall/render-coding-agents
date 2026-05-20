import type { z } from "zod";

export interface ToolExecutionOptions {
  toolCallId?: string;
  abortSignal?: AbortSignal;
  /** Injected context (replaces AI SDK's experimental_context). */
  context: unknown;
}

export interface ToolConfig {
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: z.ZodType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute: (input: any, options: ToolExecutionOptions) => Promise<unknown>;
}

/**
 * Lightweight replacement for the AI SDK `tool()` wrapper.
 * Returns the same shape so tool implementations stay unchanged
 * aside from the import path.
 */
export function defineTool<TInput>(opts: {
  description: string;
  inputSchema: z.ZodType<TInput>;
  execute: (input: TInput, options: ToolExecutionOptions) => Promise<unknown>;
}): ToolConfig {
  return opts;
}

import type { ToolConfig } from "./tools/define-tool";
import type Redis from "ioredis";

/**
 * Apply trust tier confirmation gates to tools that create or destroy infrastructure.
 * Currently a passthrough — no tools require confirmation after Render tools were removed.
 * Kept as an extension point for future gated tools.
 */
export function applyTrustTiers(
  tools: Record<string, ToolConfig>,
  _runId: string,
  _duplicateRedis: () => Redis,
  _publishFn: (event: Record<string, unknown>) => Promise<void>,
): Record<string, ToolConfig> {
  return tools;
}

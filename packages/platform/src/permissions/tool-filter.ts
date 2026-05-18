import type { ToolPermissions } from "./types";

// ---------------------------------------------------------------------------
// ToolFilter — allowlist / denylist evaluation for tool calls
// ---------------------------------------------------------------------------

export type ToolFilterDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Returns whether a tool call with `toolName` is permitted by the policy.
 * Deny list takes precedence over allow list.
 */
export function evaluateTool(
  toolName: string,
  policy: ToolPermissions,
): ToolFilterDecision {
  // Deny list has highest precedence
  if (policy.deny.length > 0) {
    const blocked = policy.deny.some(
      (d) => d === toolName || toolName.startsWith(d),
    );
    if (blocked) {
      return { allowed: false, reason: `Tool "${toolName}" is on the deny list` };
    }
  }

  // Allow list: empty = allow all
  if (policy.allow.length > 0) {
    const permitted = policy.allow.some(
      (a) => a === toolName || toolName.startsWith(a),
    );
    if (!permitted) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is not on the allow list`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Filter a list of tool names to those permitted by the policy.
 */
export function filterTools(
  tools: string[],
  policy: ToolPermissions,
): string[] {
  return tools.filter((t) => evaluateTool(t, policy).allowed);
}

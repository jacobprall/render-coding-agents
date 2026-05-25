/**
 * Context passed to agent tools via the tool execution options.
 *
 * Uses the forge-agnostic ForgeProvider interface so the agent is
 * decoupled from any specific forge implementation.
 */

import type { ForgeProvider } from "@coding-agents/platform/forge";
import type { SandboxAdapter } from "@coding-agents/sandbox";

export type { SandboxAdapter };

export interface ForgeAgentContext {
  __brand: "ForgeAgentContext";
  sessionId: string;
  projectId: string | null;
  forge: ForgeProvider;
  repoOwner: string;
  repoName: string;
  branch: string;
  baseBranch: string;
  adapter: SandboxAdapter;
  onFileChanged?: (event: FileChangedEvent) => void | Promise<void>;
  onPrCreated?: (event: { prNumber: number; prStatus: string }) => void | Promise<void>;
}

export interface FileChangedEvent {
  path: string;
  additions: number;
  deletions: number;
  unifiedDiffPreview?: string;
}

export function isForgeAgentContext(ctx: unknown): ctx is ForgeAgentContext {
  return (
    typeof ctx === "object" &&
    ctx !== null &&
    "__brand" in ctx &&
    (ctx as ForgeAgentContext).__brand === "ForgeAgentContext"
  );
}

function getAdapter(ctx: unknown): SandboxAdapter {
  if (isForgeAgentContext(ctx)) return ctx.adapter;
  throw new Error("Agent context not available — cannot access sandbox adapter");
}

function getSessionId(ctx: unknown): string {
  if (isForgeAgentContext(ctx)) return ctx.sessionId;
  throw new Error("Agent context not available — cannot determine session ID");
}

export function getSandboxContext(ctx: unknown): { adapter: SandboxAdapter; sessionId: string } {
  return { adapter: getAdapter(ctx), sessionId: getSessionId(ctx) };
}

/**
 * Minimal forge context for read-only planner passes (sandbox tools only).
 */
export function createSandboxPlannerContext(
  adapter: SandboxAdapter,
  sessionId: string,
): ForgeAgentContext {
  return {
    __brand: "ForgeAgentContext",
    sessionId,
    projectId: null,
    adapter,
    forge: null as unknown as ForgeProvider,
    repoOwner: "",
    repoName: "",
    branch: "main",
    baseBranch: "main",
  };
}

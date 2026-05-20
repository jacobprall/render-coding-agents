import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthContext } from "@coding-agents/platform";
import type { PlatformContainer } from "@coding-agents/platform/container";

export type ToolRegistrar = (
  server: McpServer,
  p: PlatformContainer,
  auth: AuthContext,
) => void;

export function textResult(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }],
  };
}

export function errorResult(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

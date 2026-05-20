/**
 * MCP (Model Context Protocol) server for the platform.
 *
 * Exposes core platform operations as MCP tools so that any MCP-compatible
 * client (Claude Desktop, Cursor, custom agents) can interact with the
 * forge headlessly.
 *
 * Uses Streamable HTTP transport (web-standard variant) so it can be
 * mounted as a regular Hono route.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthContext } from "@coding-agents/platform";
import { getPlatform } from "../platform";

import {
  registerSessionTools,
  registerRepoTools,
  registerPullRequestTools,
  registerOrgTools,
  registerProjectTools,
  registerSkillTools,
  registerInboxTools,
  registerMirrorTools,
  registerModelTools,
  registerSettingsTools,
  registerNotificationTools,
  registerInviteTools,
} from "./tools";

// ---------------------------------------------------------------------------
// Factory: build an McpServer with all tools registered
// ---------------------------------------------------------------------------

export function createMcpServer(auth: AuthContext): McpServer {
  const server = new McpServer(
    { name: "coding-agents", version: "1.0.0" },
    {
      instructions:
        "This MCP server exposes the Render Open Forge platform. " +
        "Use session tools to create agent sessions, send messages, and manage runs. " +
        "Use repo tools to manage repositories, files, and CI. " +
        "Use org tools to manage organizations and members.",
    },
  );

  const p = getPlatform();

  registerSessionTools(server, p, auth);
  registerRepoTools(server, p, auth);
  registerPullRequestTools(server, p, auth);
  registerOrgTools(server, p, auth);
  registerProjectTools(server, p, auth);
  registerSkillTools(server, p, auth);
  registerInboxTools(server, p, auth);
  registerMirrorTools(server, p, auth);
  registerModelTools(server, p, auth);
  registerSettingsTools(server, p, auth);
  registerNotificationTools(server, p, auth);
  registerInviteTools(server, p, auth);

  return server;
}

// ---------------------------------------------------------------------------
// Transport: per-session McpServer + WebStandard Streamable HTTP
// ---------------------------------------------------------------------------

const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

/**
 * Handle an incoming MCP HTTP request.
 * Creates a new transport per session (session ID from header or auto-generated).
 */
export async function handleMcpRequest(
  request: Request,
  auth: AuthContext,
): Promise<Response> {
  const sessionId = request.headers.get("mcp-session-id");

  if (sessionId && sessions.has(sessionId)) {
    const transport = sessions.get(sessionId)!;
    return transport.handleRequest(request);
  }

  const server = createMcpServer(auth);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  await server.connect(transport);

  const response = await transport.handleRequest(request);

  if (transport.sessionId) {
    sessions.set(transport.sessionId, transport);
  }

  return response;
}

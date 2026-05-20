/**
 * Gateway fetch helper — only used by webhook proxy routes.
 *
 * All browser-facing API routes now call platform services directly
 * via `getPlatform()` in `lib/platform.ts`. This file is kept solely
 * for the 3 webhook forwarding routes (GitHub, GitLab, Render) that
 * still need to proxy to the gateway's webhook handlers.
 */

const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL || "http://localhost:4100";
const GATEWAY_SECRET = process.env.GATEWAY_API_SECRET || "";

export interface GatewayFetchOptions extends Omit<RequestInit, "headers"> {
  userId?: string;
  headers?: HeadersInit;
}

export async function gatewayFetch(
  path: string,
  opts: GatewayFetchOptions = {},
): Promise<Response> {
  const { userId, headers: extraHeaders, ...init } = opts;
  const url = `${GATEWAY_URL}/api${path}`;
  const headers = new Headers(extraHeaders);

  if (GATEWAY_SECRET) {
    headers.set("Authorization", `Bearer ${GATEWAY_SECRET}`);
  }
  if (userId) {
    headers.set("X-CodingAgents-User-Id", userId);
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  return fetch(url, { ...init, headers });
}

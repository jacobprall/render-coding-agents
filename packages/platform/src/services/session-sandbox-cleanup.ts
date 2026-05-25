import { logger } from "@coding-agents/shared";

/**
 * Remove the session workspace directory on the sandbox (worktrees, clones, scratch files).
 * Called when a session is archived or deleted — not after each agent run.
 */
export async function cleanupSessionSandbox(sessionId: string): Promise<void> {
  const host = process.env.SANDBOX_SERVICE_HOST;
  const secret = process.env.SANDBOX_SHARED_SECRET;
  if (!host) return;

  const baseUrl = host.startsWith("http") ? host : `https://${host}`;
  try {
    const res = await fetch(`${baseUrl}/cleanup`, {
      method: "POST",
      headers: {
        "X-Session-Id": sessionId,
        ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      logger.warn("session.sandbox_cleanup_failed", { sessionId, status: res.status });
    }
  } catch (err) {
    logger.warn("session.sandbox_cleanup_error", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

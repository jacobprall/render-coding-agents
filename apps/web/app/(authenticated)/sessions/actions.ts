"use server";

import { requireAuth, getPlatform } from "@/lib/platform";
import { revalidatePath } from "next/cache";

async function cleanupSandboxWorkspace(sessionId: string): Promise<void> {
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
      console.warn(`[archive] sandbox cleanup failed (${res.status}) for session ${sessionId}`);
    }
  } catch (err) {
    console.warn(`[archive] sandbox cleanup error for session ${sessionId}:`, err);
  }
}

export async function archiveSessionAction(sessionId: string): Promise<{ error?: string }> {
  try {
    const auth = await requireAuth();
    await getPlatform().sessions.archive(auth, sessionId);

    // Best-effort sandbox workspace cleanup — don't block on failure
    void cleanupSandboxWorkspace(sessionId);

    revalidatePath("/sessions");
    revalidatePath("/", "layout");
    return {};
  } catch (err) {
    if (err instanceof Response) {
      const body = await err.json().catch(() => null);
      return { error: typeof body?.error === "string" ? body.error : "Unauthorized" };
    }
    return { error: err instanceof Error ? err.message : "Failed to archive session" };
  }
}

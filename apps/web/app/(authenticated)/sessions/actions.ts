"use server";

import { requireAuth, getPlatform } from "@/lib/platform";
import { getDb } from "@/lib/db";
import { sessions } from "@coding-agents/db";
import { and, eq } from "drizzle-orm";
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

export async function restoreSessionAction(sessionId: string): Promise<{ error?: string }> {
  try {
    const auth = await requireAuth();
    const db = getDb();

    const [row] = await db
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!row) return { error: "Session not found" };
    if (row.status !== "archived") {
      return { error: "Session is not archived" };
    }

    await db
      .update(sessions)
      .set({ status: "completed", updatedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)));

    revalidatePath("/sessions");
    revalidatePath("/", "layout");
    return {};
  } catch (err) {
    if (err instanceof Response) {
      const body = await err.json().catch(() => null);
      return { error: typeof body?.error === "string" ? body.error : "Unauthorized" };
    }
    return { error: err instanceof Error ? err.message : "Failed to restore session" };
  }
}

export async function renameSessionAction(
  sessionId: string,
  title: string,
): Promise<{ error?: string }> {
  const trimmed = title.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    return { error: "Title must be between 1 and 100 characters" };
  }

  try {
    const auth = await requireAuth();
    const db = getDb();

    const [row] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!row) return { error: "Session not found" };

    await db
      .update(sessions)
      .set({ title: trimmed, updatedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)));

    revalidatePath("/sessions");
    revalidatePath(`/sessions/${sessionId}`);
    revalidatePath("/", "layout");
    return {};
  } catch (err) {
    if (err instanceof Response) {
      const body = await err.json().catch(() => null);
      return { error: typeof body?.error === "string" ? body.error : "Unauthorized" };
    }
    return { error: err instanceof Error ? err.message : "Failed to rename session" };
  }
}

export async function deleteSessionAction(sessionId: string): Promise<{ error?: string }> {
  try {
    const auth = await requireAuth();
    const db = getDb();

    const [row] = await db
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!row) return { error: "Session not found" };
    if (row.status === "deleted") {
      return { error: "Session is already deleted" };
    }

    await db
      .update(sessions)
      .set({ status: "deleted", updatedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)));

    void cleanupSandboxWorkspace(sessionId);

    revalidatePath("/sessions");
    revalidatePath("/", "layout");
    return {};
  } catch (err) {
    if (err instanceof Response) {
      const body = await err.json().catch(() => null);
      return { error: typeof body?.error === "string" ? body.error : "Unauthorized" };
    }
    return { error: err instanceof Error ? err.message : "Failed to delete session" };
  }
}

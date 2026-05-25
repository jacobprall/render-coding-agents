"use server";

import { requireAuth, getPlatform } from "@/lib/platform";
import { cleanupSessionSandbox } from "@coding-agents/platform";
import { getDb } from "@/lib/db";
import { sessions } from "@coding-agents/db";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function archiveSessionAction(sessionId: string): Promise<{ error?: string }> {
  try {
    const auth = await requireAuth();
    await getPlatform().sessions.archive(auth, sessionId);

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

    void cleanupSessionSandbox(sessionId);

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

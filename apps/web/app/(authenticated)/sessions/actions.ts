"use server";

import { gatewayFetch, requireUserId } from "@/lib/gateway";
import { revalidatePath } from "next/cache";

export async function archiveSessionAction(sessionId: string): Promise<{ error?: string }> {
  try {
    const userId = await requireUserId();
    const res = await gatewayFetch(`/sessions/${sessionId}`, {
      method: "DELETE",
      userId,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return { error: typeof body?.error === "string" ? body.error : `Archive failed (${res.status})` };
    }
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

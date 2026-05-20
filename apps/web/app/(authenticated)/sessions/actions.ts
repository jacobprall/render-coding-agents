"use server";

import { requireForgeAuth, getPlatform } from "@/lib/platform";
import { revalidatePath } from "next/cache";

export async function archiveSessionAction(sessionId: string): Promise<{ error?: string }> {
  try {
    const auth = await requireForgeAuth();
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

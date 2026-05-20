import { eq } from "drizzle-orm";
import { sessions } from "@coding-agents/db";
import type { PlatformDb } from "@coding-agents/platform";

interface SessionForDelivery {
  prNumber: number | null;
  prStatus: string | null;
}

export function isDeliverComplete(session: SessionForDelivery): boolean {
  return session.prNumber != null && session.prStatus === "merged";
}

export async function transitionToComplete(db: PlatformDb, sessionId: string): Promise<void> {
  const now = new Date();
  await db
    .update(sessions)
    .set({
      status: "completed",
      phase: "complete",
      updatedAt: now,
      lastActivityAt: now,
    })
    .where(eq(sessions.id, sessionId));
}

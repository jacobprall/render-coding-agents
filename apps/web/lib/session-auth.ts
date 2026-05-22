import { eq, and } from "drizzle-orm";
import { sessions } from "@coding-agents/db";
import type { AuthContext } from "@coding-agents/platform";
import { getDb } from "@/lib/db";

export interface SessionRow {
  id: string;
  repoPath: string | null;
}

export async function requireSessionForUser(
  auth: AuthContext,
  sessionId: string,
): Promise<SessionRow> {
  const [row] = await getDb()
    .select({ id: sessions.id, repoPath: sessions.repoPath })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
    .limit(1);

  if (!row) {
    throw new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  return row;
}

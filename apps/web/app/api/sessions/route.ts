import { NextResponse, type NextRequest } from "next/server";
import { gatewayProxy, requireUserId } from "@/lib/gateway";
import { getDb } from "@/lib/db";
import { sessions } from "@coding-agents/db";
import { eq, desc, and, ne } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 100) : 50;

  const db = getDb();
  type SessionStatus = "running" | "completed" | "failed" | "archived";
  const validStatuses: SessionStatus[] = ["running", "completed", "failed", "archived"];
  const conditions = [eq(sessions.userId, userId), ne(sessions.status, "archived" satisfies SessionStatus)];
  if (status && validStatuses.includes(status as SessionStatus)) {
    conditions.push(eq(sessions.status, status as SessionStatus));
  }

  const rows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      status: sessions.status,
      repoPath: sessions.repoPath,
      lastActivityAt: sessions.lastActivityAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(and(...conditions))
    .orderBy(desc(sessions.lastActivityAt))
    .limit(limit);

  return NextResponse.json({ sessions: rows });
}

export async function POST(req: NextRequest) {
  const userId = await requireUserId();
  return gatewayProxy(req, "/sessions", userId);
}

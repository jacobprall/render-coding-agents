import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { syncConnections } from "@coding-agents/db/schema";
import { and, eq } from "drizzle-orm";
import { decryptTokenSafe } from "@coding-agents/shared/lib/encryption";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const [conn] = await db
    .select({
      id: syncConnections.id,
      remoteUsername: syncConnections.remoteUsername,
      accessToken: syncConnections.accessToken,
    })
    .from(syncConnections)
    .where(and(eq(syncConnections.userId, session.user.id), eq(syncConnections.provider, "github")))
    .limit(1);

  if (!conn?.accessToken) {
    return NextResponse.json({ connected: false });
  }

  const token = decryptTokenSafe(conn.accessToken);
  return NextResponse.json({
    connected: !!token,
    username: conn.remoteUsername,
  });
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  await db
    .delete(syncConnections)
    .where(and(eq(syncConnections.userId, session.user.id), eq(syncConnections.provider, "github")));

  return NextResponse.json({ success: true });
}

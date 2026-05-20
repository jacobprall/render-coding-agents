import { NextRequest, NextResponse } from "next/server";
import { requireUserId, gatewayProxy } from "@/lib/gateway";
import { getDb } from "@/lib/db";
import { syncConnections } from "@coding-agents/db/schema";
import { eq } from "drizzle-orm";
import { decryptTokenSafe } from "@coding-agents/shared/lib/encryption";
import { createForgeProvider } from "@coding-agents/platform/forge";

export async function GET(req: NextRequest) {
  const userId = await requireUserId();

  try {
    return await fetchReposDirect(userId);
  } catch {
    // Fall back to gateway proxy if direct fetch fails
    try {
      return await gatewayProxy(req, `/sessions/repos`, userId);
    } catch {
      return NextResponse.json({ repos: [] });
    }
  }
}

async function fetchReposDirect(userId: string): Promise<NextResponse> {
  const db = getDb();
  const conns = await db
    .select({ provider: syncConnections.provider, accessToken: syncConnections.accessToken })
    .from(syncConnections)
    .where(eq(syncConnections.userId, userId));

  const allRepos: unknown[] = [];

  for (const conn of conns) {
    const token = decryptTokenSafe(conn.accessToken);
    if (!token) continue;
    const forge = createForgeProvider({ token });
    const repos = await forge.repos.list();
    allRepos.push(...repos);
  }

  if (allRepos.length === 0) {
    throw new Error("no repos from direct fetch");
  }

  return NextResponse.json({ repos: allRepos });
}

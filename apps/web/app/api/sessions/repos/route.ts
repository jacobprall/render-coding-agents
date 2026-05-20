import { NextResponse } from "next/server";
import { requireForgeAuth, getPlatform } from "@/lib/platform";
import { syncConnections } from "@coding-agents/db/schema";
import { eq } from "drizzle-orm";
import { decryptTokenSafe } from "@coding-agents/shared/lib/encryption";
import { createForgeProvider, getForgeProviderForAuth } from "@coding-agents/platform/forge";

export async function GET() {
  try {
    const auth = await requireForgeAuth();
    const db = getPlatform().db;
    const allRepos: unknown[] = [];

    const conns = await db
      .select({ provider: syncConnections.provider, accessToken: syncConnections.accessToken })
      .from(syncConnections)
      .where(eq(syncConnections.userId, auth.userId));

    for (const conn of conns) {
      try {
        const token = decryptTokenSafe(conn.accessToken);
        if (!token) continue;
        const forge = createForgeProvider({ token });
        const repos = await forge.repos.list();
        allRepos.push(...repos);
      } catch (err) {
        console.warn(`[sessions/repos] failed to list repos from ${conn.provider}:`, err instanceof Error ? err.message : err);
      }
    }

    if (allRepos.length === 0) {
      try {
        const forge = getForgeProviderForAuth(auth);
        const repos = await forge.repos.list();
        allRepos.push(...repos);
      } catch (err) {
        console.warn("[sessions/repos] auth forge fallback failed:", err instanceof Error ? err.message : err);
      }
    }

    return NextResponse.json({ repos: allRepos });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ repos: [] });
  }
}

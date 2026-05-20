import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth, getPlatform } from "@/lib/platform";
import { syncConnections } from "@coding-agents/db/schema";
import { eq } from "drizzle-orm";
import { decryptTokenSafe } from "@coding-agents/shared/lib/encryption";
import { createForgeProvider, getForgeProviderForAuth } from "@coding-agents/platform/forge";

async function resolveForge(auth: { userId: string; forgeToken: string }) {
  const db = getPlatform().db;
  const [conn] = await db
    .select({ accessToken: syncConnections.accessToken })
    .from(syncConnections)
    .where(eq(syncConnections.userId, auth.userId))
    .limit(1);

  if (conn?.accessToken) {
    const token = decryptTokenSafe(conn.accessToken);
    if (token) return createForgeProvider({ token });
  }
  return getForgeProviderForAuth(auth);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { owner, repo } = await params;
    const forge = await resolveForge(auth);
    const branches = await forge.branches.list(owner, repo);
    return NextResponse.json({ branches });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to list branches" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { owner, repo } = await params;
    const body = await req.json();
    const forge = await resolveForge(auth);
    const fromBranch = body.from ?? "main";
    const branch = await forge.branches.create(owner, repo, body.name, fromBranch);
    return NextResponse.json({ branch }, { status: 201 });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to create branch" }, { status: 500 });
  }
}

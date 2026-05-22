import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth } from "@/lib/platform";
import { requireSessionForUser } from "@/lib/session-auth";
import { getFileDiff } from "@/lib/sandbox-client";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { id } = await params;
    const session = await requireSessionForUser(auth, id);

    if (!session.repoPath) {
      return NextResponse.json({ error: "Session has no repository" }, { status: 404 });
    }

    const url = new URL(req.url);
    const path = url.searchParams.get("path");
    if (!path) {
      return NextResponse.json({ error: "path query parameter is required" }, { status: 400 });
    }

    const result = await getFileDiff(id, path);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/git/diff] failed:", err);
    return NextResponse.json({ error: "Failed to get file diff" }, { status: 500 });
  }
}

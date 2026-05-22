import { NextResponse } from "next/server";
import { requireForgeAuth } from "@/lib/platform";
import { requireSessionForUser } from "@/lib/session-auth";
import { getGitStatus } from "@/lib/sandbox-client";

export interface GitChange {
  path: string;
  status: string;
  linesAdded: number;
  linesRemoved: number;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { id } = await params;
    const session = await requireSessionForUser(auth, id);

    if (!session.repoPath) {
      return NextResponse.json({ error: "Session has no repository" }, { status: 404 });
    }

    const result = await getGitStatus(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/git/status] failed:", err);
    return NextResponse.json({ error: "Failed to get git status" }, { status: 500 });
  }
}

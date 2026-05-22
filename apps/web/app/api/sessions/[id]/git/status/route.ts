import { NextResponse } from "next/server";
import { requireForgeAuth } from "@/lib/platform";
import { requireSessionForUser } from "@/lib/session-auth";

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

    // TODO: Fetch git status from session sandbox via platform adapter
    const changes: GitChange[] = [];

    return NextResponse.json({
      branch: "main",
      ahead: 0,
      behind: 0,
      changes,
      clean: changes.length === 0,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/git/status] failed:", err);
    return NextResponse.json({ error: "Failed to get git status" }, { status: 500 });
  }
}

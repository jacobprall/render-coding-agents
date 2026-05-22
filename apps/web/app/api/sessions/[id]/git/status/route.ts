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
      return NextResponse.json({
        branch: "main",
        ahead: 0,
        behind: 0,
        changes: [],
        clean: true,
      });
    }

    try {
      const result = await getGitStatus(id);
      return NextResponse.json(result);
    } catch (sandboxErr) {
      const msg = sandboxErr instanceof Error ? sandboxErr.message : "";
      if (msg.includes("unreachable") || msg.includes("ECONNREFUSED")) {
        return NextResponse.json({
          branch: "main",
          ahead: 0,
          behind: 0,
          changes: [],
          clean: true,
        });
      }
      throw sandboxErr;
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/git/status] failed:", err);
    return NextResponse.json({ error: "Failed to get git status" }, { status: 500 });
  }
}

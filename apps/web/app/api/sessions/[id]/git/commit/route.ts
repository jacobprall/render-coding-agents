import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireForgeAuth } from "@/lib/platform";
import { requireSessionForUser } from "@/lib/session-auth";

const CommitBodySchema = z.object({
  message: z.string().min(1),
  branch: z.string().optional(),
  createBranch: z.boolean().optional(),
});

export async function POST(
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

    const body = await req.json();
    const parsed = CommitBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { message, branch, createBranch } = parsed.data;

    // TODO: Create branch (if createBranch) and commit via session sandbox
    void message;
    void branch;
    void createBranch;

    return NextResponse.json({
      commitSha: "0000000",
      branch: branch ?? "main",
      filesChanged: 0,
      linesAdded: 0,
      linesRemoved: 0,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/git/commit] failed:", err);
    return NextResponse.json({ error: "Failed to commit changes" }, { status: 500 });
  }
}

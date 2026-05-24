import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireForgeAuth } from "@/lib/platform";
import { requireSessionForUser } from "@/lib/session-auth";
import { getUserPreferences } from "@/lib/db/loaders";
import { commitSessionChanges } from "@/lib/sandbox-client";

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

    const prefsRow = await getUserPreferences(auth.userId);
    const autoCommitPush = prefsRow?.data?.autoCommitPush ?? false;

    try {
      const result = await commitSessionChanges(id, {
        message,
        branch,
        createBranch,
        push: autoCommitPush,
      });

      return NextResponse.json({
        commitSha: result.commitSha,
        branch: result.branch,
        pushed: result.pushed,
        pushError: result.pushError,
        filesChanged: result.filesChanged,
        linesAdded: result.linesAdded,
        linesRemoved: result.linesRemoved,
      });
    } catch (commitErr) {
      const msg = commitErr instanceof Error ? commitErr.message : "Failed to commit changes";
      if (msg.includes("unreachable") || msg.includes("ECONNREFUSED")) {
        return NextResponse.json(
          { error: "Sandbox unreachable — cannot commit right now" },
          { status: 502 },
        );
      }
      if (msg.includes("No changes")) {
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/git/commit] failed:", err);
    return NextResponse.json({ error: "Failed to commit changes" }, { status: 500 });
  }
}

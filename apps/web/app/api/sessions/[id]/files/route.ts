import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth } from "@/lib/platform";
import { requireSessionForUser } from "@/lib/session-auth";
import { listDirectory } from "@/lib/sandbox-client";

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  extension?: string;
  size?: number;
  gitStatus?: string;
}

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
    const path = url.searchParams.get("path") ?? "/";

    const result = await listDirectory(id, path);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/files] list failed:", err);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}

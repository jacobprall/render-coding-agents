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
      return NextResponse.json({ path: "/", entries: [] });
    }

    const url = new URL(req.url);
    const path = url.searchParams.get("path") ?? "/";

    try {
      const result = await listDirectory(id, path);
      return NextResponse.json(result);
    } catch (sandboxErr) {
      const msg = sandboxErr instanceof Error ? sandboxErr.message : "";
      if (msg.includes("unreachable") || msg.includes("ECONNREFUSED")) {
        return NextResponse.json({ path, entries: [] });
      }
      throw sandboxErr;
    }
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/files] list failed:", err);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}

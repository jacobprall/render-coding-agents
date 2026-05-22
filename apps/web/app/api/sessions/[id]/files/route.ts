import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth } from "@/lib/platform";
import { requireSessionForUser } from "@/lib/session-auth";

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

    // TODO: Fetch directory listing from session sandbox via platform adapter
    const entries: FileEntry[] =
      path === "/"
        ? [
            { name: "src", path: "/src", type: "directory" },
            {
              name: "package.json",
              path: "/package.json",
              type: "file",
              extension: "json",
              size: 1024,
            },
            {
              name: "README.md",
              path: "/README.md",
              type: "file",
              extension: "md",
              size: 2048,
              gitStatus: "modified",
            },
          ]
        : [];

    return NextResponse.json({ path, entries });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/files] list failed:", err);
    return NextResponse.json({ error: "Failed to list files" }, { status: 500 });
  }
}

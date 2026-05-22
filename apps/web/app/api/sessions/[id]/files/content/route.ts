import { NextRequest, NextResponse } from "next/server";
import { getLanguageFromExtension, getFileExtension } from "@/lib/utils";
import { requireForgeAuth } from "@/lib/platform";
import { requireSessionForUser } from "@/lib/session-auth";

const MAX_CONTENT_BYTES = 500 * 1024;

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

    // TODO: Read file content from session sandbox via platform adapter
    const extension = getFileExtension(path.split("/").pop() ?? "");
    const placeholder = `// TODO: sandbox file content for ${path}\n`;
    const content = placeholder;
    const size = content.length;
    const truncated = size > MAX_CONTENT_BYTES;

    return NextResponse.json({
      path,
      content: truncated ? content.slice(0, MAX_CONTENT_BYTES) : content,
      language: getLanguageFromExtension(extension).toLowerCase(),
      size,
      truncated,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/files/content] read failed:", err);
    return NextResponse.json({ error: "Failed to read file content" }, { status: 500 });
  }
}

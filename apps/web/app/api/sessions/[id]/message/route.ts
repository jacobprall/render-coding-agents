import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth, getPlatform } from "@/lib/platform";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { id } = await params;
    const body = await req.json();
    const requestId = req.headers.get("x-request-id") ?? undefined;
    const result = await getPlatform().sessions.sendMessage(auth, id, {
      ...body,
      requestId,
    });
    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      runId: result.runId,
      isFirstMessage: result.isFirstMessage,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions] sendMessage failed:", err);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth, getPlatform } from "@/lib/platform";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { id } = await params;
    const body = await req.json().catch(() => undefined);
    const result = await getPlatform().sessions.enqueueReviewJob(auth, id, body);
    return NextResponse.json(result ?? { ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to enqueue review" }, { status: 500 });
  }
}

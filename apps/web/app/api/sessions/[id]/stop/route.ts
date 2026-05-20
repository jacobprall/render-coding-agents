import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth, getPlatform } from "@/lib/platform";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { id } = await params;
    const result = await getPlatform().sessions.stop(auth, id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to stop session" }, { status: 500 });
  }
}

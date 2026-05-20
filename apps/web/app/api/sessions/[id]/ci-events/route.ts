import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth, getPlatform } from "@/lib/platform";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { id } = await params;
    const events = await getPlatform().sessions.listCiEvents(auth, id);
    return NextResponse.json(events);
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to list CI events" }, { status: 500 });
  }
}

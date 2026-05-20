import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth, getPlatform } from "@/lib/platform";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { id } = await params;
    const body = await req.json();
    const result = await getPlatform().sessions.updateConfig(auth, id, body);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
  }
}

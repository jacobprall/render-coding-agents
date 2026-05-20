import { NextRequest, NextResponse } from "next/server";
import { requireForgeAuth, getPlatform } from "@/lib/platform";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { id } = await params;
    const skills = await getPlatform().sessions.getSkills(auth, id);
    return NextResponse.json(skills);
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to get skills" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { id } = await params;
    const body = await req.json();
    await getPlatform().sessions.updateSkills(auth, id, body.skills);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to update skills" }, { status: 500 });
  }
}

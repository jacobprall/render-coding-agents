import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/platform";

export async function POST() {
  try {
    await requireAuth();
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to install skill" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/platform";

export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({ skills: [] });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to list skills" }, { status: 500 });
  }
}

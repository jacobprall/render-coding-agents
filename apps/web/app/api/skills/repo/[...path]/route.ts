import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/platform";

export async function GET() {
  try {
    await requireAuth();
    return NextResponse.json({ error: "Not implemented" }, { status: 501 });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to read skill" }, { status: 500 });
  }
}

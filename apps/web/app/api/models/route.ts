import { NextResponse } from "next/server";
import { requireAuth, getPlatform } from "@/lib/platform";

export async function GET() {
  try {
    const auth = await requireAuth();
    const result = await getPlatform().models.listModels(auth);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[models] listModels failed:", err);
    return NextResponse.json({ error: "Failed to load models", models: [] }, { status: 500 });
  }
}

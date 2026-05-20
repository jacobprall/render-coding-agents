import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getPlatform } from "@/lib/platform";

export async function GET() {
  try {
    const auth = await requireAuth();
    const result = await getPlatform().settings.listApiKeys(auth);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to list API keys" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();
    const result = await getPlatform().settings.createOrUpdateApiKey(auth, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to save API key" }, { status: 500 });
  }
}

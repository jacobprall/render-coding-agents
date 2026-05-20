import { NextRequest, NextResponse } from "next/server";
import { requireAuth, getPlatform } from "@/lib/platform";

export async function GET() {
  try {
    const auth = await requireAuth();
    const tokens = await getPlatform().settings.listAccessTokens(auth);
    return NextResponse.json({ tokens });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to list access tokens" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const body = await req.json();
    const result = await getPlatform().settings.createAccessToken(auth, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Failed to create access token" }, { status: 500 });
  }
}

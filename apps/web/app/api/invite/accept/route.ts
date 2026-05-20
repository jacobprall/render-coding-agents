import { NextRequest, NextResponse } from "next/server";
import { getPlatform } from "@/lib/platform";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, password, name } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Missing invite token" }, { status: 400 });
    }
    if (!password || typeof password !== "string" || password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const platform = getPlatform();
    const result = await platform.invites.acceptInvite({
      token,
      password,
      name: typeof name === "string" ? name.trim() : undefined,
    });

    return NextResponse.json({ success: true, email: result.email });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to accept invite";
    const status = message.includes("expired") || message.includes("already been used") || message.includes("Invalid")
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getPlatform } from "@/lib/platform";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const platform = getPlatform();
  const invite = await platform.invites.getInviteByToken(token);

  if (!invite) {
    return NextResponse.json({ error: "Invalid invite token" }, { status: 404 });
  }
  if (invite.redeemedAt) {
    return NextResponse.json({ error: "This invite has already been used" }, { status: 400 });
  }
  if (invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 400 });
  }

  return NextResponse.json({
    email: invite.email,
    expiresAt: invite.expiresAt.toISOString(),
  });
}

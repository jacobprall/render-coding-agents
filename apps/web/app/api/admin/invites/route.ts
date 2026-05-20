import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPlatform } from "@/lib/platform";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || !session.isAdmin) {
    throw new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session.user.id;
}

export async function GET() {
  const _userId = await requireAdmin();
  const platform = getPlatform();
  const invites = await platform.invites.listInvites();
  return NextResponse.json({ invites });
}

export async function POST(req: NextRequest) {
  const userId = await requireAdmin();
  const body = await req.json();
  const { email } = body;

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email address is required" }, { status: 400 });
  }

  try {
    const platform = getPlatform();
    const result = await platform.invites.createInvite({ email, createdBy: userId });

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const inviteUrl = `${baseUrl}/invite/accept?token=${result.token}`;

    return NextResponse.json({
      invite: {
        id: result.inviteId,
        email: result.email,
        expiresAt: result.expiresAt.toISOString(),
        inviteUrl,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create invite";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

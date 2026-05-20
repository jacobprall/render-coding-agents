import { NextResponse } from "next/server";
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

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireAdmin();
  const { id } = await params;

  try {
    const platform = getPlatform();
    await platform.invites.revokeInvite(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to revoke invite";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

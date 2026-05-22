import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { chats } from "@coding-agents/db";
import { requireForgeAuth, getPlatform } from "@/lib/platform";
import { requireSessionForUser } from "@/lib/session-auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireForgeAuth();
    const { id: sessionId } = await params;
    await requireSessionForUser(auth, sessionId);

    const body = await req.json();
    const { action, reason } = body as { action?: string; reason?: string };

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json(
        { error: "action must be 'approve' or 'reject'" },
        { status: 400 },
      );
    }

    const platform = getPlatform();
    const { db, events } = platform;

    const [chatRow] = await db
      .select({ activeRunId: chats.activeRunId })
      .from(chats)
      .where(eq(chats.sessionId, sessionId))
      .orderBy(desc(chats.createdAt))
      .limit(1);

    const runId = chatRow?.activeRunId;
    if (!runId) {
      return NextResponse.json({ error: "No active run" }, { status: 409 });
    }

    const steerEvent = {
      type: action === "approve" ? "user:plan_approved" : "user:plan_rejected",
      ...(reason ? { reason } : {}),
    };

    await events.publishSteering(runId, steerEvent);

    await events.publish(
      runId,
      JSON.stringify({
        v: 2,
        type: steerEvent.type,
        ts: new Date().toISOString(),
        payload: { reason },
      }),
    );

    return NextResponse.json({ ok: true, runId });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/approve-plan] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

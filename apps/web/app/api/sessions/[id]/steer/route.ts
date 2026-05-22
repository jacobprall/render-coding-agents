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
    const { type, content } = body as { type?: string; content?: string };

    if (type !== "message" && type !== "interrupt") {
      return NextResponse.json(
        { error: "type must be 'message' or 'interrupt'" },
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
      type: `user:${type}`,
      ...(content ? { content } : {}),
      ...(type === "interrupt" ? { reason: content ?? "user_interrupt" } : {}),
    };

    await events.publishSteering(runId, steerEvent);

    await events.publish(
      runId,
      JSON.stringify({
        v: 2,
        type: `user:${type}`,
        ts: new Date().toISOString(),
        payload: { content, reason: type === "interrupt" ? (content ?? "user_interrupt") : undefined },
      }),
    );

    return NextResponse.json({ ok: true, runId });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error("[sessions/steer] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@coding-agents/shared";
import {
  OBSERVABILITY_EVENT_TYPES,
  OBSERVABILITY_EVENT_STATUSES,
} from "@coding-agents/db";
import { getPlatform, requireAuth } from "@/lib/platform";

const EventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
  type: z.enum(OBSERVABILITY_EVENT_TYPES).optional(),
  status: z.enum(OBSERVABILITY_EVENT_STATUSES).optional(),
  after: z.string().datetime({ offset: true }).optional(),
  before: z.string().datetime({ offset: true }).optional(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth();
    const { id } = await params;
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = EventsQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { limit, cursor, type, status, after, before } = parsed.data;

    const data = await getPlatform().observability.queryBySession(auth, id, {
      limit,
      cursor,
      type,
      status,
      after: after ? new Date(after) : undefined,
      before: before ? new Date(before) : undefined,
    });

    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof Response) return err;
    if (err instanceof AppError) {
      return NextResponse.json(err.toJSON(), { status: err.httpStatus });
    }
    return NextResponse.json({ error: "Failed to list observability events" }, { status: 500 });
  }
}

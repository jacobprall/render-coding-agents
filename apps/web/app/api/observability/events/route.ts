import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@coding-agents/shared";
import {
  OBSERVABILITY_EVENT_TYPES,
  OBSERVABILITY_EVENT_STATUSES,
} from "@coding-agents/db";
import { getPlatform, requireAuth } from "@/lib/platform";

function splitCommaParam(value: string | undefined): string | string[] | undefined {
  if (!value) return undefined;
  if (!value.includes(",")) return value;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

const EventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
  type: z
    .union([
      z.enum(OBSERVABILITY_EVENT_TYPES),
      z.array(z.enum(OBSERVABILITY_EVENT_TYPES)),
    ])
    .optional(),
  status: z
    .union([
      z.enum(OBSERVABILITY_EVENT_STATUSES),
      z.array(z.enum(OBSERVABILITY_EVENT_STATUSES)),
    ])
    .optional(),
  sessionId: z.string().optional(),
  after: z.string().datetime({ offset: true }).optional(),
  before: z.string().datetime({ offset: true }).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const prepared = {
      ...raw,
      type: splitCommaParam(raw.type),
      status: splitCommaParam(raw.status),
    };
    const parsed = EventsQuerySchema.safeParse(prepared);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { limit, cursor, type, status, sessionId, after, before } = parsed.data;

    const result = await getPlatform().observability.queryEvents(auth, {
      limit,
      cursor,
      type,
      status,
      sessionId,
      after: after ? new Date(after) : undefined,
      before: before ? new Date(before) : undefined,
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    if (err instanceof AppError) {
      return NextResponse.json(err.toJSON(), { status: err.httpStatus });
    }
    return NextResponse.json({ error: "Failed to query observability events" }, { status: 500 });
  }
}

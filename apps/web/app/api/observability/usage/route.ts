import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@coding-agents/shared";
import { getPlatform, requireAuth } from "@/lib/platform";

const UsageQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  groupBy: z.enum(["model", "session"]).default("model"),
});

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth();
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = UsageQuerySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { from, to, groupBy } = parsed.data;
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const aggregate = await getPlatform().observability.aggregateUsage(auth, {
      from: from ? new Date(from) : defaultFrom,
      to: to ? new Date(to) : now,
      groupBy,
    });

    return NextResponse.json(aggregate);
  } catch (err) {
    if (err instanceof Response) return err;
    if (err instanceof AppError) {
      return NextResponse.json(err.toJSON(), { status: err.httpStatus });
    }
    return NextResponse.json({ error: "Failed to aggregate observability usage" }, { status: 500 });
  }
}

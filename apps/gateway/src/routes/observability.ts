import { Hono } from "hono";
import { z } from "zod";
import {
  OBSERVABILITY_EVENT_TYPES,
  OBSERVABILITY_EVENT_STATUSES,
} from "@coding-agents/db";
import type { GatewayEnv } from "../middleware/auth";
import { getPlatform } from "../platform";
import { formatZodError } from "../middleware/validation";

const EventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().optional(),
  type: z.enum(OBSERVABILITY_EVENT_TYPES).optional(),
  status: z.enum(OBSERVABILITY_EVENT_STATUSES).optional(),
  after: z.string().datetime({ offset: true }).optional(),
  before: z.string().datetime({ offset: true }).optional(),
});

const UsageQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  groupBy: z.enum(["model", "session"]).default("model"),
});

export const observabilityRoutes = new Hono<GatewayEnv>();

observabilityRoutes.get("/sessions/:id/events", async (c) => {
  const auth = c.get("auth");
  const sessionId = c.req.param("id");
  const parsed = EventsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: formatZodError(parsed.error) }, 400);

  const { limit, cursor, type, status, after, before } = parsed.data;

  const data = await getPlatform().observability.queryBySession(auth, sessionId, {
    limit,
    cursor,
    type,
    status,
    after: after ? new Date(after) : undefined,
    before: before ? new Date(before) : undefined,
  });

  return c.json(data);
});

observabilityRoutes.get("/usage", async (c) => {
  const auth = c.get("auth");
  const parsed = UsageQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: formatZodError(parsed.error) }, 400);

  const { from, to, groupBy } = parsed.data;
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const aggregate = await getPlatform().observability.aggregateUsage(auth, {
    from: from ? new Date(from) : defaultFrom,
    to: to ? new Date(to) : now,
    groupBy,
  });

  return c.json(aggregate);
});

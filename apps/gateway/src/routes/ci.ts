import { Hono } from "hono";
import { ciResultPayloadSchema } from "@coding-agents/platform/services";
import { getPlatform } from "../platform";
import { formatZodError } from "../middleware/validation";

export const ciRoutes = new Hono();

ciRoutes.post("/results", async (c) => {
  const secret = c.req.header("x-ci-secret") ?? "";
  const raw = await c.req.json();
  const body = ciResultPayloadSchema.safeParse(raw);
  if (!body.success) return c.json({ error: formatZodError(body.error) }, 400);

  await getPlatform().ci.handleResult(secret, body.data);
  return c.json({ ok: true });
});

import { Hono } from "hono";
import type { GatewayEnv } from "../middleware/auth";
import { getPlatform } from "../platform";

export const modelRoutes = new Hono<GatewayEnv>();

modelRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  try {
    const result = await getPlatform().models.listModels(auth);
    if (result.models.length === 0) {
      console.warn(`[models] returned 0 models for user ${auth.userId} — check API keys`);
    }
    return c.json(result);
  } catch (err) {
    console.error("[models] listModels failed:", err);
    return c.json({ error: "Failed to list models", models: [] }, 500);
  }
});

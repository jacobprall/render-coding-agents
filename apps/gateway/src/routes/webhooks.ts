import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { webhookDeliveries } from "@coding-agents/db";
import { ValidationError, logger } from "@coding-agents/shared";
import {
  githubWebhookToInboundEvent,
} from "@coding-agents/platform";
import { getPlatform } from "../platform";

// ---------------------------------------------------------------------------
// Idempotency helper
// ---------------------------------------------------------------------------

async function tryRecordDelivery(
  deliveryId: string,
  source: string,
  kind: string,
): Promise<boolean> {
  const db = getPlatform().db;
  const result = await db
    .insert(webhookDeliveries)
    .values({
      id: deliveryId,
      source,
      kind,
      receivedAt: new Date(),
    })
    .onConflictDoNothing({ target: webhookDeliveries.id })
    .returning({ id: webhookDeliveries.id });

  return result.length > 0;
}

export const webhookRoutes = new Hono();

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

webhookRoutes.post("/github", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? null;
  const event = c.req.header("x-github-event") ?? null;
  const deliveryId = c.req.header("x-github-delivery");

  const platform = getPlatform();

  try {
    await platform.webhooks.handleGithubWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 401);
    throw err;
  }

  const event_ = githubWebhookToInboundEvent(event, rawBody, deliveryId);

  if (deliveryId) {
    const isNew = await tryRecordDelivery(deliveryId, "github", event_.kind);
    if (!isNew) {
      logger.info("inbound.duplicate", { eventId: deliveryId, source: "github" });
      return c.json({ ok: true, duplicate: true });
    }
  }

  logger.info("inbound.received", {
    eventId: event_.id,
    source: event_.source,
    kind: event_.kind,
    repo: event_.repo?.fullName,
  });

  const routeAction = platform.inboundRouter.evaluate(event_);

  if (routeAction.type === "coalesce" || event_.kind === "pr_synchronize") {
    await platform.inboundDispatcher.dispatch(routeAction);
  }

  try {
    await platform.webhooks.handleGithubEvent(event, rawBody);
  } catch {
    return c.json({ error: "Event processing failed" }, 500);
  }

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Generic webhook — arbitrary JSON payload with HMAC-SHA256 verification
// ---------------------------------------------------------------------------

function verifyGenericWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  const expected = hmac.digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "");
  if (expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

webhookRoutes.post("/generic", async (c) => {
  const rawBody = await c.req.text();

  const genericSecret = process.env.GENERIC_WEBHOOK_SECRET;
  const signatureHeader = c.req.header("x-webhook-signature") ?? null;
  const authHeader = c.req.header("Authorization");

  let callerUserId: string | undefined;

  if (genericSecret) {
    if (!verifyGenericWebhookSignature(rawBody, signatureHeader, genericSecret)) {
      if (!authHeader) {
        return c.json({ error: "Invalid signature and no Authorization header" }, 401);
      }
    }
  } else if (!authHeader) {
    return c.json({ error: "No authentication provided" }, 401);
  }

  if (authHeader && !callerUserId) {
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : authHeader.trim();

    const platform = getPlatform();
    const gatewaySecret = process.env.GATEWAY_API_SECRET;
    if (gatewaySecret && token.length === gatewaySecret.length && timingSafeEqual(Buffer.from(token), Buffer.from(gatewaySecret))) {
      callerUserId = c.req.header("X-CodingAgents-User-Id") ?? undefined;
    } else {
      const { createHash } = await import("node:crypto");
      const hashed = createHash("sha256").update(token).digest("hex");
      const { apiKeys } = await import("@coding-agents/db");
      const [keyRow] = await platform.db
        .select({ userId: apiKeys.userId })
        .from(apiKeys)
        .where(eq(apiKeys.hashedKey, hashed))
        .limit(1);
      callerUserId = keyRow?.userId;
    }

    if (!callerUserId) {
      return c.json({ error: "Invalid API key" }, 401);
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const description = typeof payload.description === "string" ? payload.description : undefined;
  if (!description) {
    return c.json({ error: "Missing required field: description" }, 400);
  }

  const deliveryId =
    c.req.header("x-webhook-delivery-id") ??
    (typeof payload.delivery_id === "string" ? payload.delivery_id : undefined);

  if (deliveryId) {
    const isNew = await tryRecordDelivery(deliveryId, "generic", "webhook_trigger");
    if (!isNew) {
      logger.info("inbound.duplicate", { eventId: deliveryId, source: "generic" });
      return c.json({ ok: true, duplicate: true });
    }
  }

  const repoUrl = typeof payload.repo_url === "string" ? payload.repo_url : undefined;
  const branch = typeof payload.branch === "string" ? payload.branch : undefined;
  const model = typeof payload.model === "string" ? payload.model : undefined;

  logger.info("generic webhook received", {
    deliveryId,
    hasUser: !!callerUserId,
    hasRepo: !!repoUrl,
  });

  const platform = getPlatform();

  try {
    const result = await platform.sessions.createFromWebhook({
      userId: callerUserId,
      description,
      repoUrl,
      branch,
      model,
      metadata: payload,
    });

    return c.json({
      ok: true,
      sessionId: result?.sessionId,
      runId: result?.runId,
    });
  } catch (err) {
    logger.errorWithCause(err, "generic webhook: failed to create session", {
      deliveryId,
    });
    return c.json({ error: "Processing failed" }, 500);
  }
});

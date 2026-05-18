import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { webhookDeliveries } from "@openforge/db";
import { ValidationError, logger } from "@openforge/shared";
import {
  githubWebhookToInboundEvent,
  forgejoWebhookToInboundEvent,
  gitlabWebhookToInboundEvent,
  renderWebhookToInboundEvent,
} from "@openforge/platform";
import { getPlatform } from "../platform";

// ---------------------------------------------------------------------------
// Idempotency helper
// ---------------------------------------------------------------------------

/** Returns true if this delivery was already processed (duplicate). */
async function isDuplicateDelivery(deliveryId: string | undefined): Promise<boolean> {
  if (!deliveryId) return false;
  const platform = getPlatform();
  const [existing] = await platform.db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);
  return !!existing;
}

/** Record a delivery as processed. */
async function recordDelivery(
  deliveryId: string | undefined,
  source: string,
  kind: string,
): Promise<void> {
  if (!deliveryId) return;
  const platform = getPlatform();
  await platform.db
    .insert(webhookDeliveries)
    .values({ id: deliveryId, source, kind, processed: true })
    .onConflictDoNothing();
}

export const webhookRoutes = new Hono();

// ---------------------------------------------------------------------------
// Forgejo
// ---------------------------------------------------------------------------

webhookRoutes.post("/forgejo", async (c) => {
  const rawBody = await c.req.text();
  const signature =
    c.req.header("x-forgejo-signature") ??
    c.req.header("x-gitea-signature") ??
    null;
  const event =
    c.req.header("x-forgejo-event") ??
    c.req.header("x-gitea-event") ??
    null;
  const deliveryId = c.req.header("x-forgejo-delivery") ?? c.req.header("x-gitea-delivery");

  const platform = getPlatform();

  try {
    await platform.webhooks.handleForgejoWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 401);
    throw err;
  }

  // Parse InboundEvent for traceability and routing
  const event_ = forgejoWebhookToInboundEvent(event, rawBody, deliveryId);

  // Idempotency check
  if (deliveryId && await isDuplicateDelivery(deliveryId)) {
    logger.info("inbound.duplicate", { eventId: deliveryId, source: "forgejo" });
    return c.json({ ok: true, duplicate: true });
  }
  logger.info("inbound.received", {
    eventId: event_.id,
    source: event_.source,
    kind: event_.kind,
    repo: event_.repo?.fullName,
  });

  // Evaluate routing (for coalescing and new routing decisions)
  const routeAction = platform.inboundRouter.evaluate(event_);

  // Coalesce: cancel stale runs for updated PRs before the existing handler runs
  if (routeAction.type === "coalesce") {
    await platform.inboundDispatcher.dispatch(routeAction);
  }

  // Delegate to existing handler for all provider-specific side effects
  // (prNumber updates, ciEvents inserts, prEvents inserts, auto-merge, etc.)
  try {
    await platform.webhooks.handleForgejoEvent(event, rawBody);
  } catch (err) {
    return c.json({ error: "Event processing failed" }, 500);
  }

  await recordDelivery(deliveryId, "forgejo", event_.kind);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

webhookRoutes.post("/github", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-hub-signature-256") ?? null;
  const event = c.req.header("x-github-event") ?? null;
  const deliveryId = c.req.header("x-github-delivery");

  const platform = getPlatform();

  // Signature verification (skips gracefully when no secret configured)
  try {
    await platform.webhooks.handleGithubWebhook(rawBody, signature);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 401);
    throw err;
  }

  // Parse InboundEvent for traceability and routing
  const event_ = githubWebhookToInboundEvent(event, rawBody, deliveryId);

  // Idempotency check
  if (deliveryId && await isDuplicateDelivery(deliveryId)) {
    logger.info("inbound.duplicate", { eventId: deliveryId, source: "github" });
    return c.json({ ok: true, duplicate: true });
  }

  logger.info("inbound.received", {
    eventId: event_.id,
    source: event_.source,
    kind: event_.kind,
    repo: event_.repo?.fullName,
  });

  const routeAction = platform.inboundRouter.evaluate(event_);

  // Coalesce or dispatch directly for GitHub events not handled by the legacy handler
  // (GitHub handler currently only handles review comments on mirrored repos)
  if (routeAction.type === "coalesce" || event_.kind === "pr_synchronize") {
    // Cancel stale runs when a PR receives new commits
    await platform.inboundDispatcher.dispatch(routeAction);
  }

  // Delegate to existing handler for review comment dispatch via mirrors
  try {
    await platform.webhooks.handleGithubEvent(event, rawBody);
  } catch (err) {
    return c.json({ error: "Event processing failed" }, 500);
  }

  await recordDelivery(deliveryId, "github", event_.kind);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GitLab
// ---------------------------------------------------------------------------

webhookRoutes.post("/gitlab", async (c) => {
  const rawBody = await c.req.text();
  const token = c.req.header("x-gitlab-token") ?? null;
  const event = c.req.header("x-gitlab-event") ?? null;
  const deliveryId = c.req.header("x-gitlab-event-uuid");

  const platform = getPlatform();

  try {
    await platform.webhooks.handleGitlabWebhook(rawBody, token);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message }, 401);
    throw err;
  }

  // Parse InboundEvent for traceability and routing
  const event_ = gitlabWebhookToInboundEvent(event, rawBody, deliveryId);

  // Idempotency check
  if (deliveryId && await isDuplicateDelivery(deliveryId)) {
    logger.info("inbound.duplicate", { eventId: deliveryId, source: "gitlab" });
    return c.json({ ok: true, duplicate: true });
  }

  logger.info("inbound.received", {
    eventId: event_.id,
    source: event_.source,
    kind: event_.kind,
    repo: event_.repo?.fullName,
  });

  const routeAction = platform.inboundRouter.evaluate(event_);

  // Coalesce stale runs for updated MRs
  if (routeAction.type === "coalesce") {
    await platform.inboundDispatcher.dispatch(routeAction);
  }

  try {
    await platform.webhooks.handleGitlabEvent(event, rawBody);
  } catch (err) {
    return c.json({ error: "Event processing failed" }, 500);
  }

  await recordDelivery(deliveryId, "gitlab", event_.kind);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Render deploy webhook
// ---------------------------------------------------------------------------

function verifyRenderSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  const expected = hmac.digest("hex");
  const provided = signatureHeader.replace(/^sha256=/, "");
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"));
  } catch {
    return false;
  }
}

const FAILURE_STATUSES = new Set([
  "build_failed",
  "update_failed",
  "deactivated",
  "pre_deploy_failed",
]);

webhookRoutes.post("/render", async (c) => {
  const secret = process.env.RENDER_WEBHOOK_SECRET;
  if (!secret) return c.json({ error: "RENDER_WEBHOOK_SECRET not configured" }, 500);

  const rawBody = await c.req.text();
  const signature =
    c.req.header("render-signature") ?? c.req.header("x-render-signature") ?? null;

  if (!verifyRenderSignature(rawBody, signature, secret)) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Parse into InboundEvent for traceability
  const event_ = renderWebhookToInboundEvent(rawBody);
  logger.info("inbound.received", {
    eventId: event_.id,
    source: event_.source,
    kind: event_.kind,
  });

  let payload: {
    type?: string;
    data?: {
      id?: string;
      serviceId?: string;
      serviceName?: string;
      status?: string;
      commit?: { id?: string; message?: string };
    };
  };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const data = payload.data;
  if (!data?.serviceId || !data?.status)
    return c.json({ received: true, action: "ignored" });
  if (!FAILURE_STATUSES.has(data.status))
    return c.json({ received: true, action: "ignored", status: data.status });

  logger.info("render webhook: deploy failure detected", {
    serviceId: data.serviceId,
    deployId: data.id,
    status: data.status,
  });

  const platform = getPlatform();

  // Use router to confirm this is a deploy_failure and dispatch
  const routeAction = platform.inboundRouter.evaluate(event_);
  if (routeAction.type === "create_diagnostic_session") {
    try {
      const result = await platform.sessions.createFromDeployFailure({
        serviceId: data.serviceId,
        serviceName: data.serviceName ?? data.serviceId,
        deployId: data.id ?? "unknown",
        commitId: data.commit?.id,
        commitMessage: data.commit?.message,
      });
      if (!result) return c.json({ received: true, action: "no_matching_resource" });
      return c.json({
        received: true,
        action: "session_created",
        sessionId: result.sessionId,
        runId: result.runId,
      });
    } catch (err) {
      logger.errorWithCause(err, "render webhook: failed to create diagnostic session", {
        serviceId: data.serviceId,
      });
      return c.json({ error: "Processing failed" }, 500);
    }
  }

  return c.json({ received: true, action: "ignored" });
});

// ---------------------------------------------------------------------------
// Generic webhook — arbitrary JSON payload with HMAC-SHA256 verification
// ---------------------------------------------------------------------------
// Callers authenticate via:
//   1. API key in Authorization header (same as gateway auth) → identifies user
//   2. Optional HMAC signature in x-webhook-signature header (shared secret)
//
// The payload must include at minimum a `description` field. The endpoint
// creates and enqueues a new agent session to process the request.
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

  // Authenticate caller — require either GENERIC_WEBHOOK_SECRET HMAC or
  // a valid API key in the Authorization header
  const genericSecret = process.env.GENERIC_WEBHOOK_SECRET;
  const signatureHeader = c.req.header("x-webhook-signature") ?? null;
  const authHeader = c.req.header("Authorization");

  let callerUserId: string | undefined;

  if (genericSecret) {
    if (!verifyGenericWebhookSignature(rawBody, signatureHeader, genericSecret)) {
      // Fall through to API key auth
      if (!authHeader) {
        return c.json({ error: "Invalid signature and no Authorization header" }, 401);
      }
    }
  } else if (!authHeader) {
    return c.json({ error: "No authentication provided" }, 401);
  }

  // If we have an Authorization header, resolve the user
  if (authHeader && !callerUserId) {
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : authHeader.trim();

    const platform = getPlatform();
    // Check if it's the gateway secret for impersonation
    const gatewaySecret = process.env.GATEWAY_API_SECRET;
    if (gatewaySecret && token === gatewaySecret) {
      callerUserId = c.req.header("X-OpenForge-User-Id") ?? undefined;
    } else {
      // Look up API key
      const { createHash } = await import("node:crypto");
      const hashed = createHash("sha256").update(token).digest("hex");
      const { apiKeys } = await import("@openforge/db");
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

  // Parse payload
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

  // Idempotency check
  if (deliveryId && await isDuplicateDelivery(deliveryId)) {
    logger.info("inbound.duplicate", { eventId: deliveryId, source: "generic" });
    return c.json({ ok: true, duplicate: true });
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

  // Create a session and enqueue the agent job
  try {
    const result = await platform.sessions.createFromWebhook({
      userId: callerUserId,
      description,
      repoUrl,
      branch,
      model,
      metadata: payload,
    });

    await recordDelivery(deliveryId, "generic", "webhook_trigger");

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

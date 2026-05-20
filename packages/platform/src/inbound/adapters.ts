/**
 * InboundEvent adapters — parse raw webhook payloads from different providers
 * into the canonical InboundEvent shape.
 */

import type {
  InboundEvent,
  InboundKind,
  InboundRepo,
  InboundPR,
  InboundActor,
} from "./types";

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function toRepo(repository: unknown): InboundRepo | undefined {
  if (!repository || typeof repository !== "object") return undefined;
  const r = repository as Record<string, unknown>;
  const fullName =
    typeof r.full_name === "string"
      ? r.full_name
      : typeof r.fullName === "string"
        ? (r.fullName as string)
        : undefined;
  if (!fullName) return undefined;
  const [owner, name] = fullName.split("/");
  if (!owner || !name) return undefined;
  const cloneUrl =
    typeof r.clone_url === "string"
      ? r.clone_url
      : typeof r.html_url === "string"
        ? `${r.html_url}.git`
        : undefined;
  return { fullName, owner, name, cloneUrl };
}

function toPR(pr: unknown): InboundPR | undefined {
  if (!pr || typeof pr !== "object") return undefined;
  const p = pr as Record<string, unknown>;
  const number =
    typeof p.number === "number" ? p.number : Number(p.number ?? Number.NaN);
  if (!Number.isFinite(number)) return undefined;
  const head = p.head as Record<string, unknown> | undefined;
  return {
    number,
    headSha: typeof head?.sha === "string" ? head.sha : undefined,
    title: typeof p.title === "string" ? p.title : undefined,
    branch: typeof head?.ref === "string" ? head.ref : undefined,
  };
}

function toActor(user: unknown): InboundActor | undefined {
  if (!user || typeof user !== "object") return undefined;
  const u = user as Record<string, unknown>;
  return {
    login: typeof u.login === "string" ? u.login : undefined,
    email: typeof u.email === "string" ? u.email : undefined,
  };
}

// ---------------------------------------------------------------------------
// GitHub adapter
// ---------------------------------------------------------------------------

export function githubWebhookToInboundEvent(
  event: string | null,
  rawBody: string,
  deliveryId?: string,
): InboundEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    // keep empty payload
  }

  const id = deliveryId ?? (payload["x-github-delivery"] as string | undefined) ?? crypto.randomUUID();
  const action = typeof payload.action === "string" ? payload.action : undefined;
  const repo = toRepo(payload.repository);

  let kind: InboundKind = "unknown";
  let pr: InboundPR | undefined;
  const extraPayload: Record<string, unknown> = {};

  switch (event) {
    case "pull_request": {
      pr = toPR(payload.pull_request);
      if (action === "opened" || action === "reopened") {
        kind = "pr_opened";
      } else if (action === "synchronize") {
        kind = "pr_synchronize";
      } else if (action === "closed") {
        kind = (payload.pull_request as Record<string, unknown>)?.merged === true
          ? "pr_merged"
          : "pr_closed";
      }
      break;
    }
    case "pull_request_review_comment":
    case "issue_comment": {
      kind = "review_comment";
      const comment = payload.comment as Record<string, unknown> | undefined;
      if (comment) {
        extraPayload.body = comment.body;
        extraPayload.path = comment.path;
      }
      const prRaw = payload.pull_request ?? payload.issue;
      pr = toPR(prRaw);
      break;
    }
    default:
      kind = "unknown";
  }

  return {
    id,
    source: "github",
    kind,
    actor: toActor(payload.sender),
    repo,
    pr,
    payload: { ...payload, ...extraPayload },
    receivedAt: new Date(),
  };
}

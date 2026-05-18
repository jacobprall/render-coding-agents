/**
 * InboundEvent adapters — parse raw webhook payloads from different providers
 * into the canonical InboundEvent shape.
 */

import type {
  InboundEvent,
  InboundKind,
  InboundSource,
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

// ---------------------------------------------------------------------------
// Forgejo adapter
// ---------------------------------------------------------------------------

export function forgejoWebhookToInboundEvent(
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

  const id = deliveryId ?? crypto.randomUUID();
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
      } else if (action === "synchronized") {
        kind = "pr_synchronize";
      } else if (action === "closed") {
        kind = (payload.pull_request as Record<string, unknown>)?.merged === true
          ? "pr_merged"
          : "pr_closed";
      }
      break;
    }
    case "issue_comment":
    case "pull_request_review_comment": {
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
    case "workflow_run": {
      const wr = payload.workflow_run as Record<string, unknown> | undefined;
      const conclusion = typeof wr?.conclusion === "string" ? wr.conclusion : "";
      kind = conclusion === "success" ? "ci_success" : "ci_failure";
      const headBranch = typeof wr?.head_branch === "string" ? wr.head_branch : undefined;
      extraPayload.workflowName = typeof wr?.name === "string" ? wr.name : "unknown";
      extraPayload.branch = headBranch;
      break;
    }
    default:
      kind = "unknown";
  }

  return {
    id,
    source: "forgejo",
    kind,
    actor: toActor(payload.sender),
    repo,
    pr,
    payload: { ...payload, ...extraPayload },
    receivedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// GitLab adapter
// ---------------------------------------------------------------------------

export function gitlabWebhookToInboundEvent(
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

  const id = deliveryId ?? crypto.randomUUID();
  const project = payload.project as Record<string, unknown> | undefined;
  const fullName = typeof project?.path_with_namespace === "string" ? project.path_with_namespace : undefined;
  const cloneUrl = typeof project?.http_url === "string" ? project.http_url : undefined;
  const repo: InboundEvent["repo"] = fullName
    ? (() => {
        const [owner, name] = fullName.split("/");
        return owner && name ? { fullName, owner, name, cloneUrl } : undefined;
      })()
    : undefined;

  let kind: InboundKind = "unknown";
  let pr: InboundPR | undefined;
  const extraPayload: Record<string, unknown> = {};

  if (event === "Note Hook") {
    const attrs = payload.object_attributes as Record<string, unknown> | undefined;
    if (attrs?.noteable_type === "MergeRequest") {
      kind = "review_comment";
      const mr = payload.merge_request as Record<string, unknown> | undefined;
      extraPayload.body = attrs?.note;
      extraPayload.path = (attrs?.position as Record<string, unknown>)?.new_path;
      if (mr) {
        pr = {
          number: typeof mr.iid === "number" ? mr.iid : Number(mr.iid ?? Number.NaN),
          title: typeof mr.title === "string" ? mr.title : undefined,
        };
      }
    }
  } else if (event === "Merge Request Hook") {
    const attrs = payload.object_attributes as Record<string, unknown> | undefined;
    const action = typeof attrs?.action === "string" ? attrs.action : undefined;
    const iid = typeof attrs?.iid === "number" ? attrs.iid : Number(attrs?.iid ?? Number.NaN);
    pr = Number.isFinite(iid) ? { number: iid, title: typeof attrs?.title === "string" ? attrs.title : undefined } : undefined;
    if (action === "open") kind = "pr_opened";
    else if (action === "merge") kind = "pr_merged";
    else if (action === "close") kind = "pr_closed";
    else if (action === "update") kind = "pr_synchronize";
  }

  const user = payload.user as Record<string, unknown> | undefined;
  return {
    id,
    source: "gitlab",
    kind,
    actor: user ? { login: typeof user.username === "string" ? user.username : undefined } : undefined,
    repo,
    pr,
    payload: { ...payload, ...extraPayload },
    receivedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Render deploy webhook adapter
// ---------------------------------------------------------------------------

const FAILURE_STATUSES = new Set([
  "build_failed",
  "update_failed",
  "deactivated",
  "pre_deploy_failed",
]);

export function renderWebhookToInboundEvent(rawBody: string): InboundEvent {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    // keep empty payload
  }

  const data = payload.data as Record<string, unknown> | undefined;
  const status = typeof data?.status === "string" ? data.status : "";
  const kind: InboundKind = FAILURE_STATUSES.has(status) ? "deploy_failure" : "unknown";

  return {
    id: crypto.randomUUID(),
    source: "render",
    kind,
    payload: {
      serviceId: data?.serviceId,
      serviceName: data?.serviceName ?? data?.serviceId,
      deployId: data?.id,
      commitId: (data?.commit as Record<string, unknown> | undefined)?.id,
      commitMessage: (data?.commit as Record<string, unknown> | undefined)?.message,
      status,
    },
    receivedAt: new Date(),
  };
}

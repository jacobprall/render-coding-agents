// ---------------------------------------------------------------------------
// Canonical inbound event types
// ---------------------------------------------------------------------------
// Every external signal — GitHub webhook, GitLab webhook, Forgejo webhook,
// CI callback, Render deploy hook, chat message — is normalised into an
// InboundEvent before any routing or dispatch logic runs. This lets the
// router be source-agnostic and makes tracing / logging uniform.
// ---------------------------------------------------------------------------

export type InboundSource =
  | "github"
  | "gitlab"
  | "forgejo"
  | "render"
  | "ci"
  | "chat"
  | "mcp";

export type InboundKind =
  | "review_comment"   // a human left a review comment on a PR
  | "pr_opened"        // a new PR was opened
  | "pr_synchronize"   // PR received new commits (coalescing candidate)
  | "pr_merged"        // PR was merged
  | "pr_closed"        // PR was closed without merging
  | "ci_failure"       // CI workflow failed
  | "ci_success"       // CI workflow succeeded
  | "deploy_failure"   // a production deploy failed
  | "chat_message"     // user sent a chat message
  | "unknown";         // unrecognised event — route to ignore

export interface InboundActor {
  login?: string;
  email?: string;
}

export interface InboundRepo {
  /** owner/repo — canonical form */
  fullName: string;
  owner: string;
  name: string;
  cloneUrl?: string;
}

export interface InboundPR {
  number: number;
  headSha?: string;
  title?: string;
  branch?: string;
}

// ---------------------------------------------------------------------------
// InboundEvent — the canonical normalised form of every external signal
// ---------------------------------------------------------------------------

export interface InboundEvent {
  /** Unique identifier — delivery ID, UUID, etc. Used for idempotency. */
  id: string;
  source: InboundSource;
  kind: InboundKind;
  actor?: InboundActor;
  repo?: InboundRepo;
  pr?: InboundPR;
  /** Raw source payload — passed through to downstream handlers unchanged. */
  payload: Record<string, unknown>;
  receivedAt: Date;
}

// ---------------------------------------------------------------------------
// Route actions — what the router decides to do with an InboundEvent
// ---------------------------------------------------------------------------

/** Trigger kinds accepted by CIService.enqueueSessionTriggerJob */
export type AgentTriggerKind =
  | "review_comment"
  | "pr_opened"
  | "pr_merged"
  | "workflow_run"
  | "ci_failure";

export interface TriggerSessionAction {
  type: "trigger_session";
  trigger: AgentTriggerKind;
  /** Human-readable context injected as the agent's next user message */
  fixContext: string;
  /** How to locate the target session(s) */
  sessionMatcher: SessionMatcher;
}

export interface CreateDiagnosticSessionAction {
  type: "create_diagnostic_session";
  serviceId: string;
  serviceName: string;
  deployId: string;
  commitId?: string;
  commitMessage?: string;
}

export interface CoalesceAction {
  type: "coalesce";
  /** Cancel active runs for this repo/PR before executing `then` */
  repo: string;
  prNumber: number;
  then: TriggerSessionAction | CreateDiagnosticSessionAction | IgnoreAction;
}

export interface IgnoreAction {
  type: "ignore";
  reason: string;
}

export type RouteAction =
  | TriggerSessionAction
  | CreateDiagnosticSessionAction
  | CoalesceAction
  | IgnoreAction;

// ---------------------------------------------------------------------------
// Session matcher — how to find the sessions an action targets
// ---------------------------------------------------------------------------

export type SessionMatcher =
  | { by: "repo_pr"; repo: string; prNumber: number }
  | { by: "repo_branch"; repo: string; branch: string }
  | { by: "mirror_repo"; remoteUrl: string };

// ---------------------------------------------------------------------------
// Route rule — a match predicate + action factory
// ---------------------------------------------------------------------------

export type RouteMatcher = (event: InboundEvent) => boolean;
export type RouteActionFactory = (event: InboundEvent) => RouteAction;

export interface InboundRoute {
  name: string;
  match: RouteMatcher;
  handle: RouteActionFactory;
}

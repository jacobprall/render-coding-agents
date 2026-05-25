import { and, asc, desc, eq } from "drizzle-orm";
import {
  agentRuns,
  chatMessages,
  chats,
  ciEvents,
  infraResources,
  prEvents,
  projects,
  projectRepos,
  sessions,
  specs,
  userPreferences,
} from "@coding-agents/db";
import type { CiEvent, SessionPhase } from "@coding-agents/db";
import {
  SessionNotFoundError,
  ValidationError,
  logger,
} from "@coding-agents/shared";
import { mergeTurnSkillRefs, normalizeActiveSkills, type ActiveSkillRef } from "./session-skills";
import type { PlatformDb } from "../interfaces/database";
import type { AuthContext } from "../interfaces/auth";
import type { QueueAdapter } from "../interfaces/queue";
import type { EventBus } from "../interfaces/events";
import { getForgeProviderForAuth } from "../forge/factory";
import { resolveLlmApiKeys } from "../auth/api-key-resolver";
import { askUserReplyQueueKey } from "../events/run-stream";
import { validateModel } from "./session-model-validation";
import { generateAutoTitle as generateAutoTitleImpl } from "./session-auto-title";
import {
  DEFAULT_MODEL_ID,
  startAgentJob,
  enqueueSessionTriggerJob,
  getOrCreateChatId,
} from "./session-agent-jobs";
import { assertValidTransition, type AgentRunStatus } from "../state-machine";
import {
  resolveWorkspaceConfig,
  mergeSessionOverrides,
  decryptSecrets,
} from "./workspace";
import { cleanupSessionSandbox } from "./session-sandbox-cleanup";

// ---------------------------------------------------------------------------
// Re-exports from sub-modules (preserves the public API surface)
// ---------------------------------------------------------------------------

export type { AutoTitleResult } from "./session-auto-title";
export type { AgentTrigger } from "./session-agent-jobs";

// ---------------------------------------------------------------------------
// Parameter types
// ---------------------------------------------------------------------------

export interface CreateSessionParams {
  repoPath?: string;
  branch?: string;
  baseBranch?: string;
  title?: string;
  forgeType?: "github" | "gitlab";
  activeSkills?: Array<{ source: "builtin" | "user" | "repo"; slug: string }>;
  firstMessage?: string;
  modelId?: string;
  projectId?: string;
  sessionEnvOverrides?: Record<string, string>;
  sessionSkillsOverrides?: Array<{ source: "builtin" | "user" | "repo"; slug: string }>;
}

export interface AttachRepoParams {
  repoPath: string;
  branch?: string;
}

export interface SendMessageParams {
  content: string;
  modelId?: string;
  /** Caller-supplied request ID for tracing (falls back to a new UUID). */
  requestId?: string;
  /** One-shot skills for this message only; merged into the job payload, not persisted. */
  turnSkillRefs?: ActiveSkillRef[];
}

export interface ReplyParams {
  toolCallId: string;
  message: string;
  /** Explicit run ID; if omitted, the chat's activeRunId is used. */
  runId?: string;
}

export interface SpecActionParams {
  action: "approve" | "reject";
  specId: string;
  rejectionNote?: string;
}

export interface ReviewJobParams {
  /** Caller-supplied trigger context; defaults to a standard review prompt. */
  fixContext?: string;
}

// ---------------------------------------------------------------------------
// Valid session phases
// ---------------------------------------------------------------------------

const VALID_PHASES: SessionPhase[] = [
  "understand",
  "spec",
  "execute",
  "verify",
  "deliver",
  "complete",
  "failed",
];

// ---------------------------------------------------------------------------
// SessionService
// ---------------------------------------------------------------------------

export class SessionService {
  constructor(
    private db: PlatformDb,
    private queue: QueueAdapter,
    private events: EventBus,
  ) {}

  // -------------------------------------------------------------------------
  // create — POST /api/sessions
  // -------------------------------------------------------------------------

  async create(auth: AuthContext, params: CreateSessionParams): Promise<{ sessionId: string }> {
    const { repoPath, branch, activeSkills, forgeType, baseBranch } = params;
    const isScratch = !repoPath;
    const title = (params.title && String(params.title).trim()) || (isScratch ? "Scratch session" : "New session");

    const sessionId = crypto.randomUUID();
    const chatId = crypto.randomUUID();

    const [prefsRow] = await this.db
      .select({ data: userPreferences.data })
      .from(userPreferences)
      .where(eq(userPreferences.userId, auth.userId))
      .limit(1);
    const preferredModel = prefsRow?.data?.defaultModelId ?? undefined;

    let resolvedBaseBranch: string | null = null;
    let resolvedBranch: string | null = null;
    let resolvedForgeType: "github" | "gitlab" | null = null;

    if (!isScratch) {
      resolvedBranch = branch || "main";
      resolvedForgeType = forgeType ?? auth.forgeType ?? "github";
      resolvedBaseBranch = baseBranch || "main";
      if (!baseBranch) {
        try {
          const forge = getForgeProviderForAuth(auth);
          const slashIdx = repoPath!.indexOf("/");
          const owner = slashIdx > 0 ? repoPath!.slice(0, slashIdx) : "";
          const name = slashIdx > 0 ? repoPath!.slice(slashIdx + 1) : "";
          if (owner && name) {
            const repo = await forge.repos.get(owner, name);
            resolvedBaseBranch = repo.defaultBranch || "main";
          }
        } catch {
          // Fall back to "main"
        }
      }
    }

    let projectConfig: Record<string, unknown> | null = null;
    let projectContext: string | null = null;
    if (params.projectId) {
      try {
        const [proj] = await this.db
          .select({ config: projects.config, instructions: projects.instructions })
          .from(projects)
          .where(eq(projects.id, params.projectId))
          .limit(1);
        if (proj) {
          projectConfig = proj.config as Record<string, unknown> | null;
          projectContext = proj.instructions;
        }
      } catch {
        // Non-critical: proceed without project context
      }
    }

    const sessionEnvOverrides = params.sessionEnvOverrides ?? {};
    const sessionSkillsOverrides = params.sessionSkillsOverrides ?? [];
    let reposUsed: string[] = [];
    let workspaceJobPayload: Record<string, unknown> = {};

    if (params.projectId) {
      try {
        const workspace = await resolveWorkspaceConfig(this.db, params.projectId);
        const { mergedEnv, mergedSkills } = mergeSessionOverrides(
          workspace,
          sessionEnvOverrides,
          sessionSkillsOverrides,
        );

        reposUsed = workspace.repos.map((r) => r.repoPath);

        const decryptedSecrets = decryptSecrets(workspace.secretsConfig);
        const resolvedSecrets: Record<string, string> = {
          ...(decryptedSecrets.env ?? {}),
        };
        for (const [key, value] of Object.entries(decryptedSecrets.runtime ?? {})) {
          resolvedSecrets[`__SECRET__${key}`] = value;
        }

        workspaceJobPayload = {
          workspaceId: params.projectId,
          resolvedEnv: mergedEnv,
          resolvedSecrets,
          resolvedSkills: mergedSkills,
          repos: workspace.repos,
        };
      } catch (err) {
        if (err instanceof Error) {
          if (err.message.includes("Session env overrides cannot shadow")) {
            throw new ValidationError(err.message);
          }
          if (err.message.startsWith("Project not found:")) {
            throw new ValidationError("Project not found");
          }
        }
        throw err;
      }
    }

    await this.db.insert(sessions).values({
      id: sessionId,
      userId: auth.userId,
      forgeUsername: auth.username,
      title,
      status: "running",
      projectId: params.projectId ?? null,
      repoPath: repoPath ?? null,
      forgeType: resolvedForgeType,
      branch: resolvedBranch,
      baseBranch: resolvedBaseBranch,
      phase: "execute",
      workflowMode: "standard",
      activeSkills: Array.isArray(activeSkills) && activeSkills.length > 0 ? activeSkills : null,
      projectConfig,
      projectContext,
      sessionEnvOverrides: Object.keys(sessionEnvOverrides).length > 0 ? sessionEnvOverrides : {},
      sessionSkillsOverrides: sessionSkillsOverrides.length > 0 ? sessionSkillsOverrides : [],
      reposUsed,
    });

    const modelId = params.modelId?.trim() || preferredModel || DEFAULT_MODEL_ID;

    await this.db.insert(chats).values({
      id: chatId,
      sessionId,
      title,
      ...(modelId ? { modelId } : {}),
    });

    const firstMessage = params.firstMessage?.trim();
    if (firstMessage) {
      const messageId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const requestId = crypto.randomUUID();

      await this.db.insert(chatMessages).values({
        id: messageId,
        chatId,
        role: "user",
        parts: [{ type: "text", text: firstMessage }],
      });

      await this.db.insert(agentRuns).values({
        id: runId,
        chatId,
        sessionId,
        userId: auth.userId,
        modelId,
        status: "queued",
        createdAt: new Date(),
      });

      await this.db
        .update(chats)
        .set({ activeRunId: runId, updatedAt: new Date() })
        .where(eq(chats.id, chatId));

      const activeSkillRefs =
        (workspaceJobPayload.resolvedSkills as ActiveSkillRef[] | undefined)?.length
          ? (workspaceJobPayload.resolvedSkills as ActiveSkillRef[])
          : normalizeActiveSkills(null);

      await this.queue.ensureGroup();
      await this.queue.enqueue({
        runId,
        chatId,
        sessionId,
        userId: auth.userId,
        messages: [{ role: "user" as const, content: [{ type: "text", text: firstMessage }] }],
        activeSkillRefs,
        modelId,
        requestId,
        maxRetries: 3,
        ...workspaceJobPayload,
      });
    }

    return { sessionId };
  }

  // -------------------------------------------------------------------------
  // archive — server action / API
  // -------------------------------------------------------------------------

  async archive(auth: AuthContext, sessionId: string): Promise<void> {
    const [row] = await this.db
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!row) throw new SessionNotFoundError();
    if (row.status === "archived") {
      throw new ValidationError("Session is already archived");
    }

    // If session is still "running", check whether there's actually an active run
    if (row.status === "running") {
      const [activeChat] = await this.db
        .select({ activeRunId: chats.activeRunId })
        .from(chats)
        .where(eq(chats.sessionId, sessionId))
        .orderBy(desc(chats.createdAt))
        .limit(1);

      if (activeChat?.activeRunId) {
        const [activeRun] = await this.db
          .select({ status: agentRuns.status })
          .from(agentRuns)
          .where(eq(agentRuns.id, activeChat.activeRunId))
          .limit(1);

        if (activeRun && (activeRun.status === "running" || activeRun.status === "queued")) {
          throw new ValidationError("Cannot archive a session with an active run — stop it first");
        }
      }
    }

    await this.db
      .update(sessions)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)));

    void cleanupSessionSandbox(sessionId);
  }

  // -------------------------------------------------------------------------
  // attachRepo — bind a repo to a scratch session
  // -------------------------------------------------------------------------

  async attachRepo(
    auth: AuthContext,
    sessionId: string,
    params: AttachRepoParams,
  ): Promise<void> {
    const [row] = await this.db
      .select({ id: sessions.id, repoPath: sessions.repoPath })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!row) throw new SessionNotFoundError();

    const { repoPath, branch } = params;
    const forgeType = auth.forgeType ?? "github";

    let resolvedBaseBranch = "main";
    try {
      const forge = getForgeProviderForAuth(auth);
      const slashIdx = repoPath.indexOf("/");
      const owner = slashIdx > 0 ? repoPath.slice(0, slashIdx) : "";
      const name = slashIdx > 0 ? repoPath.slice(slashIdx + 1) : "";
      if (owner && name) {
        const repo = await forge.repos.get(owner, name);
        resolvedBaseBranch = repo.defaultBranch || "main";
      }
    } catch {
      // Fall back to "main"
    }

    await this.db
      .update(sessions)
      .set({
        repoPath,
        forgeType,
        branch: branch || resolvedBaseBranch,
        baseBranch: resolvedBaseBranch,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, sessionId));

    // Link repo to the session's project if not already linked
    const [sessionFull] = await this.db
      .select({ projectId: sessions.projectId })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);
    if (sessionFull?.projectId) {
      try {
        const existing = await this.db
          .select({ id: projectRepos.id })
          .from(projectRepos)
          .where(
            and(
              eq(projectRepos.projectId, sessionFull.projectId),
              eq(projectRepos.repoPath, repoPath),
            ),
          )
          .limit(1);
        if (existing.length === 0) {
          await this.db.insert(projectRepos).values({
            id: crypto.randomUUID(),
            projectId: sessionFull.projectId,
            repoPath,
            forgeType,
            defaultBranch: resolvedBaseBranch,
            isPrimary: false,
          });
        }
      } catch {
        // Non-critical: project_repo link failed
      }
    }
  }

  // -------------------------------------------------------------------------
  // sendMessage — POST /api/sessions/[id]/message
  // -------------------------------------------------------------------------

  async sendMessage(
    auth: AuthContext,
    sessionId: string,
    params: SendMessageParams,
  ): Promise<{ messageId: string; runId: string; isFirstMessage: boolean }> {
    const { content, requestId: callerRequestId, turnSkillRefs } = params;
    const requestId = callerRequestId ?? crypto.randomUUID();

    const [sessionRow] = await this.db
      .select({
        id: sessions.id,
        title: sessions.title,
        repoPath: sessions.repoPath,
        branch: sessions.branch,
        baseBranch: sessions.baseBranch,
        forgeType: sessions.forgeType,
        activeSkills: sessions.activeSkills,
        forgeUsername: sessions.forgeUsername,
        projectConfig: sessions.projectConfig,
        projectContext: sessions.projectContext,
        projectId: sessions.projectId,
        sessionEnvOverrides: sessions.sessionEnvOverrides,
        sessionSkillsOverrides: sessions.sessionSkillsOverrides,
      })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!sessionRow) {
      throw new SessionNotFoundError();
    }

    // Validate model if provided
    const requestedModelId = params.modelId?.trim() || undefined;
    if (requestedModelId) {
      try {
        const keys = await resolveLlmApiKeys(this.db, auth.userId);
        const vr = await validateModel(requestedModelId, keys);
        if (!vr.ok) {
          throw new ValidationError(vr.error, { details: { available: vr.available } });
        }
      } catch (err) {
        if (err instanceof ValidationError) throw err;
        // Catalog fetch failed — proceed with requested model
      }
    }

    // Get or create the most recent chat
    let isFirstMessage = false;
    let [chatRow] = await this.db
      .select()
      .from(chats)
      .where(eq(chats.sessionId, sessionId))
      .orderBy(desc(chats.createdAt))
      .limit(1);

    if (!chatRow) {
      isFirstMessage = true;
      const chatId = crypto.randomUUID();
      [chatRow] = await this.db
        .insert(chats)
        .values({
          id: chatId,
          sessionId,
          title: sessionRow.title,
        })
        .returning();
    }

    // Abort previous active run if still running/queued
    if (chatRow.activeRunId) {
      const [activeRun] = await this.db
        .select({ status: agentRuns.status })
        .from(agentRuns)
        .where(eq(agentRuns.id, chatRow.activeRunId))
        .limit(1);

      if (activeRun && (activeRun.status === "running" || activeRun.status === "queued")) {
        await Promise.all([
          this.events.setKey(`run:${chatRow.activeRunId}:abort`, "1", 3600),
          this.db
            .update(chats)
            .set({ activeRunId: null, updatedAt: new Date() })
            .where(eq(chats.id, chatRow.id)),
        ]);
      }
    }

    const modelId = requestedModelId ?? DEFAULT_MODEL_ID;
    const messageId = crypto.randomUUID();
    const runId = crypto.randomUUID();

    // Insert message and create run row in parallel
    await Promise.all([
      this.db.insert(chatMessages).values({
        id: messageId,
        chatId: chatRow.id,
        role: "user",
        parts: [{ type: "text", text: content }],
      }),
      this.db.insert(agentRuns).values({
        id: runId,
        chatId: chatRow.id,
        sessionId,
        userId: auth.userId,
        modelId,
        status: "queued",
        createdAt: new Date(),
      }),
    ]);

    // Update chat active run and session status back to running
    await Promise.all([
      this.db
        .update(chats)
        .set({ activeRunId: runId, updatedAt: new Date() })
        .where(eq(chats.id, chatRow.id)),
      this.db
        .update(sessions)
        .set({ status: "running", lastActivityAt: new Date(), updatedAt: new Date() })
        .where(eq(sessions.id, sessionId)),
    ]);

    // For the first message we already know the full history — skip the query.
    const messages: Array<{ role: "user" | "assistant"; content: unknown }> = isFirstMessage
      ? [{ role: "user", content: [{ type: "text", text: content }] }]
      : (await this.db
          .select({ role: chatMessages.role, parts: chatMessages.parts })
          .from(chatMessages)
          .where(eq(chatMessages.chatId, chatRow.id))
          .orderBy(asc(chatMessages.createdAt))
        ).map((m) => ({ role: m.role as "user" | "assistant", content: m.parts }));

    const activeSkillRefs = mergeTurnSkillRefs(
      sessionRow.activeSkills as ActiveSkillRef[] | null,
      turnSkillRefs,
    );

    let workspaceJobPayload: Record<string, unknown> = {};
    if (sessionRow.projectId) {
      try {
        const workspace = await resolveWorkspaceConfig(this.db, sessionRow.projectId);
        const { mergedEnv, mergedSkills } = mergeSessionOverrides(
          workspace,
          (sessionRow.sessionEnvOverrides as Record<string, string>) ?? {},
          (sessionRow.sessionSkillsOverrides as Array<{ source: "builtin" | "user" | "repo"; slug: string }>) ?? [],
        );

        const decryptedSecrets = decryptSecrets(workspace.secretsConfig);
        const resolvedSecrets: Record<string, string> = {
          ...(decryptedSecrets.env ?? {}),
        };
        for (const [key, value] of Object.entries(decryptedSecrets.runtime ?? {})) {
          resolvedSecrets[`__SECRET__${key}`] = value;
        }

        // Pre-render the project block so the worker doesn't re-query projects/projectRepos.
        const projectBlockLines = ["# Project", "", `- **Name:** ${workspace.projectName ?? sessionRow.projectId}`];
        if (workspace.projectInstructions) {
          projectBlockLines.push("", "## Project Instructions", "", workspace.projectInstructions);
        }
        if (workspace.repos.length > 0) {
          projectBlockLines.push("", "## Linked Repos");
          for (const r of workspace.repos) {
            projectBlockLines.push(`- ${r.repoPath}${r.isPrimary ? " (primary)" : ""}`);
          }
        }

        workspaceJobPayload = {
          workspaceId: sessionRow.projectId,
          resolvedEnv: mergedEnv,
          resolvedSecrets,
          resolvedSkills: mergedSkills,
          repos: workspace.repos,
          projectBlock: projectBlockLines.join("\n"),
        };
      } catch {
        // Non-critical: proceed without workspace config
      }
    }

    await this.queue.ensureGroup();
    await this.queue.enqueue({
      runId,
      chatId: chatRow.id,
      sessionId,
      userId: auth.userId,
      messages,
      activeSkillRefs,
      projectConfig: sessionRow.projectConfig ?? undefined,
      projectContext: sessionRow.projectContext ?? undefined,
      modelId,
      requestId,
      maxRetries: 3,
      sessionContext: {
        repoPath: sessionRow.repoPath,
        branch: sessionRow.branch,
        baseBranch: sessionRow.baseBranch,
        title: sessionRow.title,
        forgeType: sessionRow.forgeType,
        projectId: sessionRow.projectId,
      },
      ...workspaceJobPayload,
    });

    return { messageId, runId, isFirstMessage };
  }

  // -------------------------------------------------------------------------
  // getActiveRunId — shared helper for stream/stop
  // -------------------------------------------------------------------------

  async getActiveRunId(auth: AuthContext, sessionId: string): Promise<string | null> {
    const [sessionRow] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!sessionRow) throw new SessionNotFoundError();

    const [chatRow] = await this.db
      .select({ activeRunId: chats.activeRunId })
      .from(chats)
      .where(eq(chats.sessionId, sessionId))
      .orderBy(desc(chats.createdAt))
      .limit(1);

    return chatRow?.activeRunId ?? null;
  }

  // -------------------------------------------------------------------------
  // stop — POST /api/sessions/[id]/stop
  // -------------------------------------------------------------------------

  async stop(auth: AuthContext, sessionId: string): Promise<{ runId: string; acknowledged: boolean }> {
    const [sessionRow] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!sessionRow) throw new SessionNotFoundError();

    const [chatRow] = await this.db
      .select()
      .from(chats)
      .where(eq(chats.sessionId, sessionId))
      .orderBy(desc(chats.createdAt))
      .limit(1);

    const runId = chatRow?.activeRunId;
    if (!runId) {
      return { runId: "", acknowledged: true };
    }

    await this.events.setKey(`run:${runId}:abort`, "1", 3600);

    logger.info("session.stop.abort_signal_set", { runId });

    return { runId, acknowledged: true };
  }

  // -------------------------------------------------------------------------
  // pause — POST /api/sessions/[id]/pause
  // -------------------------------------------------------------------------

  async pause(auth: AuthContext, sessionId: string): Promise<{ runId: string }> {
    const [sessionRow] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!sessionRow) throw new SessionNotFoundError();

    const [chatRow] = await this.db
      .select()
      .from(chats)
      .where(eq(chats.sessionId, sessionId))
      .orderBy(desc(chats.createdAt))
      .limit(1);

    const runId = chatRow?.activeRunId;
    if (!runId) {
      throw new ValidationError("No active run to pause");
    }

    // Signal the agent worker to pause after current step
    await this.events.setKey(`run:${runId}:pause`, "1", 3600);

    logger.warn("session.pause.signal_not_enforced", {
      runId,
      message:
        "Pause signal written to Redis but agent worker does not yet consume it",
    });

    const [currentRun] = await this.db
      .select({ status: agentRuns.status })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1);
    if (!currentRun) {
      throw new ValidationError("Active run record not found");
    }
    assertValidTransition(currentRun.status as AgentRunStatus, "paused");

    // Update run status
    await this.db
      .update(agentRuns)
      .set({ status: "paused" })
      .where(eq(agentRuns.id, runId));

    // Publish pause event on the run stream
    await this.events.publish(`run:${runId}`, JSON.stringify({
      type: "paused",
      runId,
      timestamp: new Date().toISOString(),
    }));

    return { runId };
  }

  // -------------------------------------------------------------------------
  // resume — POST /api/sessions/[id]/resume
  // -------------------------------------------------------------------------

  async resume(auth: AuthContext, sessionId: string): Promise<{ runId: string }> {
    const [sessionRow] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!sessionRow) throw new SessionNotFoundError();

    const [chatRow] = await this.db
      .select()
      .from(chats)
      .where(eq(chats.sessionId, sessionId))
      .orderBy(desc(chats.createdAt))
      .limit(1);

    const runId = chatRow?.activeRunId;
    if (!runId) {
      throw new ValidationError("No active run to resume");
    }

    // Clear the pause flag
    await this.events.setKey(`run:${runId}:pause`, "", 1);

    const [currentRun] = await this.db
      .select({ status: agentRuns.status })
      .from(agentRuns)
      .where(eq(agentRuns.id, runId))
      .limit(1);
    if (!currentRun) {
      throw new ValidationError("Active run record not found");
    }
    assertValidTransition(currentRun.status as AgentRunStatus, "running");

    // Update run status back to running
    await this.db
      .update(agentRuns)
      .set({ status: "running" })
      .where(eq(agentRuns.id, runId));

    // Publish resume event on the run stream
    await this.events.publish(`run:${runId}`, JSON.stringify({
      type: "resumed",
      runId,
      timestamp: new Date().toISOString(),
    }));

    return { runId };
  }

  // -------------------------------------------------------------------------
  // updatePhase — POST /api/sessions/[id]/phase
  // -------------------------------------------------------------------------

  async updatePhase(auth: AuthContext, sessionId: string, phase: string): Promise<void> {
    if (!phase || !VALID_PHASES.includes(phase as SessionPhase)) {
      throw new ValidationError("Invalid phase");
    }

    const updated = await this.db
      .update(sessions)
      .set({
        phase: phase as SessionPhase,
        updatedAt: new Date(),
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .returning({ id: sessions.id });

    if (updated.length === 0) throw new SessionNotFoundError();
  }

  // -------------------------------------------------------------------------
  // reply — POST /api/sessions/[id]/reply
  // -------------------------------------------------------------------------

  async reply(auth: AuthContext, sessionId: string, params: ReplyParams): Promise<void> {
    const { toolCallId, message, runId: explicitRunId } = params;

    if (!toolCallId || !message?.trim()) {
      throw new ValidationError("toolCallId and message required");
    }

    const [sessionRow] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!sessionRow) throw new SessionNotFoundError();

    const [chatRow] = await this.db
      .select()
      .from(chats)
      .where(eq(chats.sessionId, sessionId))
      .orderBy(desc(chats.createdAt))
      .limit(1);

    const effectiveRunId = explicitRunId ?? chatRow?.activeRunId;
    if (!effectiveRunId) {
      throw new ValidationError("No active agent run — cannot deliver reply");
    }

    // Validate the run belongs to this session
    const [run] = await this.db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(and(eq(agentRuns.id, effectiveRunId), eq(agentRuns.sessionId, sessionId)))
      .limit(1);
    if (!run) {
      throw new ValidationError("Invalid run context");
    }

    const key = askUserReplyQueueKey(effectiveRunId, toolCallId);
    await this.events.listPush(key, JSON.stringify({ message: message.trim() }));
  }

  // -------------------------------------------------------------------------
  // updateConfig — PATCH /api/sessions/[id]/config
  // -------------------------------------------------------------------------

  async updateConfig(
    auth: AuthContext,
    sessionId: string,
    configPatch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!configPatch || typeof configPatch !== "object" || Array.isArray(configPatch)) {
      throw new ValidationError("Provide projectConfig or projectConfigPatch object");
    }

    const [row] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!row) throw new SessionNotFoundError();

    const base =
      typeof row.projectConfig === "object" && row.projectConfig !== null
        ? ({ ...(row.projectConfig as object) } as Record<string, unknown>)
        : {};
    Object.assign(base, configPatch);

    const [updated] = await this.db
      .update(sessions)
      .set({
        projectConfig: Object.keys(base).length ? base : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .returning({ id: sessions.id, projectConfig: sessions.projectConfig });

    return (updated?.projectConfig ?? {}) as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // getSkills — GET /api/sessions/[id]/skills
  // -------------------------------------------------------------------------

  async getSkills(auth: AuthContext, sessionId: string): Promise<ActiveSkillRef[]> {
    const [row] = await this.db
      .select({ activeSkills: sessions.activeSkills })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!row) throw new SessionNotFoundError();

    return (row.activeSkills ?? []) as ActiveSkillRef[];
  }

  // -------------------------------------------------------------------------
  // updateSkills — PATCH /api/sessions/[id]/skills
  // -------------------------------------------------------------------------

  async updateSkills(
    auth: AuthContext,
    sessionId: string,
    activeSkills: ActiveSkillRef[],
  ): Promise<void> {
    if (!Array.isArray(activeSkills)) {
      throw new ValidationError("activeSkills array required");
    }

    for (const r of activeSkills) {
      if (
        !r ||
        (r.source !== "builtin" && r.source !== "user" && r.source !== "repo") ||
        typeof r.slug !== "string"
      ) {
        throw new ValidationError("Invalid skill ref");
      }
    }

    const updated = await this.db
      .update(sessions)
      .set({
        activeSkills,
        updatedAt: new Date(),
      })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .returning({ id: sessions.id });

    if (updated.length === 0) throw new SessionNotFoundError();
  }

  // -------------------------------------------------------------------------
  // handleSpecAction — POST /api/sessions/[id]/spec
  // -------------------------------------------------------------------------

  async handleSpecAction(
    auth: AuthContext,
    sessionId: string,
    params: SpecActionParams,
  ): Promise<{ runId: string }> {
    const { action, specId, rejectionNote = "" } = params;

    if (!action || !specId) {
      throw new ValidationError("action and specId required");
    }

    const [sessionRow] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!sessionRow) throw new SessionNotFoundError();

    const [specRow] = await this.db
      .select()
      .from(specs)
      .where(and(eq(specs.id, specId), eq(specs.sessionId, sessionId)))
      .limit(1);

    if (!specRow) {
      throw new SessionNotFoundError("Spec not found");
    }

    const chatId = await getOrCreateChatId(this.db, sessionId, sessionRow.title);

    try {
      if (action === "approve") {
        await this.db
          .update(specs)
          .set({ status: "approved", approvedAt: new Date() })
          .where(eq(specs.id, specId));

        await this.db.insert(chatMessages).values({
          id: crypto.randomUUID(),
          chatId,
          role: "user",
          parts: [
            {
              type: "text",
              text: `Specification approved.\nGoal: ${specRow.goal}\nProceed with implementation as specified.`,
            },
          ],
        });

        const runId = await startAgentJob(this.db, this.queue, {
          sessionRow,
          chatId,
          authUserId: auth.userId,
          authUsername: auth.username,
          forgeToken: auth.forgeToken,
          projectConfigPatch: { lastApprovedSpecId: specId },
        });

        return { runId };
      }

      // reject
      if (!rejectionNote.trim()) {
        throw new ValidationError("rejectionNote required when rejecting");
      }

      await this.db
        .update(specs)
        .set({ status: "rejected", rejectionNote })
        .where(eq(specs.id, specId));

      await this.db.insert(chatMessages).values({
        id: crypto.randomUUID(),
        chatId,
        role: "user",
        parts: [
          {
            type: "text",
            text: `Specification was rejected.\nReviewer feedback:\n${rejectionNote.trim()}\nProduce a revised specification.`,
          },
        ],
      });

      const runId = await startAgentJob(this.db, this.queue, {
        sessionRow,
        chatId,
        authUserId: auth.userId,
        authUsername: auth.username,
        forgeToken: auth.forgeToken,
        fixContext: `Revise specification per feedback:\n${rejectionNote.trim()}`,
      });

      return { runId };
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      logger.errorWithCause(err, "spec action failed", { sessionId });
      throw new ValidationError("Failed to enqueue agent job");
    }
  }

  // -------------------------------------------------------------------------
  // generateAutoTitle — POST /api/sessions/[id]/auto-title
  // -------------------------------------------------------------------------

  async generateAutoTitle(
    sessionId: string,
    userId: string,
  ): Promise<import("./session-auto-title").AutoTitleResult> {
    return generateAutoTitleImpl(this.db, sessionId, userId);
  }

  // -------------------------------------------------------------------------
  // listCiEvents — GET /api/sessions/[id]/ci-events
  // -------------------------------------------------------------------------

  async listCiEvents(auth: AuthContext, sessionId: string): Promise<CiEvent[]> {
    const [s] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!s) throw new SessionNotFoundError();

    return this.db
      .select()
      .from(ciEvents)
      .where(eq(ciEvents.sessionId, sessionId))
      .orderBy(desc(ciEvents.createdAt))
      .limit(50);
  }

  // -------------------------------------------------------------------------
  // createFromDeployFailure — called by Render webhook
  // -------------------------------------------------------------------------

  async createFromDeployFailure(params: {
    serviceId: string;
    serviceName: string;
    deployId: string;
    commitId?: string;
    commitMessage?: string;
  }): Promise<{ sessionId: string; runId: string } | null> {
    const { serviceId, serviceName, deployId, commitId, commitMessage } = params;

    // Look up which session/repo owns this service via infraResources
    const [resource] = await this.db
      .select({
        projectId: infraResources.projectId,
        name: infraResources.name,
      })
      .from(infraResources)
      .where(eq(infraResources.externalId, serviceId))
      .limit(1);

    if (!resource) {
      logger.warn("deploy_failure webhook: no tracked resource for service", { serviceId });
      return null;
    }

    // Find the most recent session for this project to determine user/repo context
    const [latestSession] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.projectId, resource.projectId))
      .orderBy(desc(sessions.lastActivityAt))
      .limit(1);

    if (!latestSession) {
      logger.warn("deploy_failure webhook: no session found for project", { projectId: resource.projectId });
      return null;
    }

    const title = `Deploy failure: ${serviceName}`;
    const sessionId = crypto.randomUUID();
    const chatId = crypto.randomUUID();

    await this.db.insert(sessions).values({
      id: sessionId,
      userId: latestSession.userId,
      forgeUsername: latestSession.forgeUsername,
      title,
      status: "running",
      repoPath: latestSession.repoPath,
      forgeType: latestSession.forgeType ?? "github",
      branch: latestSession.branch,
      baseBranch: latestSession.baseBranch ?? "main",
      phase: "execute",
      workflowMode: "standard",
      projectContext: JSON.stringify({
        deployFailure: {
          serviceId,
          serviceName,
          deployId,
          commitId,
          commitMessage,
        },
      }),
    });

    await this.db.insert(chats).values({ id: chatId, sessionId, title });

    const diagnosticPrompt = [
      `A deploy just failed on Render.`,
      `- Service: ${serviceName} (ID: ${serviceId})`,
      `- Deploy ID: ${deployId}`,
      commitId ? `- Commit: ${commitId}` : null,
      commitMessage ? `- Commit message: ${commitMessage}` : null,
      ``,
      `Diagnose the failure:`,
      `1. Use render_get_logs to read the deploy/build logs for service ${serviceId}`,
      `2. Identify the root cause (build error, runtime crash, missing env var, etc.)`,
      `3. If it's a code issue, fix it and push a commit`,
      `4. If it's a configuration issue (env vars, build settings), explain what needs to change and ask for confirmation`,
      `5. After fixing, trigger a redeploy with render_deploy`,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await enqueueSessionTriggerJob(this.db, this.queue, {
      sessionRow: {
        ...latestSession,
        id: sessionId,
        title,
        projectContext: null,
      },
      userId: latestSession.userId,
      chatTitle: title,
      trigger: "deploy_failure",
      fixContext: diagnosticPrompt,
    });

    if (!result) return null;

    // Create an inbox notification via prEvents
    await this.db.insert(prEvents).values({
      id: crypto.randomUUID(),
      userId: latestSession.userId,
      sessionId,
      repoPath: latestSession.repoPath ?? "",
      prNumber: latestSession.prNumber ?? 0,
      action: "ci_failed",
      title,
      actionNeeded: true,
      read: false,
      metadata: {
        deployFailure: true,
        serviceId,
        deployId,
        runId: result.runId,
      },
    });

    return { sessionId, runId: result.runId };
  }

  // -------------------------------------------------------------------------
  // createFromWebhook — generic webhook triggers a new session + agent run
  // -------------------------------------------------------------------------

  async createFromWebhook(params: {
    userId?: string;
    description: string;
    repoUrl?: string;
    branch?: string;
    model?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ sessionId: string; runId: string } | null> {
    const { description, repoUrl, branch, model, metadata } = params;

    // Resolve user — use provided userId or fall back to system user
    const userId = params.userId ?? process.env.CODING_AGENTS_SYSTEM_USER_ID;
    if (!userId) {
      logger.warn("generic webhook: no userId and no CODING_AGENTS_SYSTEM_USER_ID", {});
      return null;
    }

    // Derive repoPath from URL if provided (e.g. "https://github.com/owner/repo.git" → "owner/repo")
    let repoPath: string | null = null;
    if (repoUrl) {
      const match = repoUrl.match(/[/:]([^/]+\/[^/.]+?)(?:\.git)?$/);
      if (match) repoPath = match[1]!;
    }

    const sessionId = crypto.randomUUID();
    const chatId = crypto.randomUUID();
    const title = description.slice(0, 100);

    await this.db.insert(sessions).values({
      id: sessionId,
      userId,
      title,
      status: "running",
      repoPath,
      branch: branch ?? "main",
      baseBranch: "main",
      phase: "execute",
      workflowMode: "standard",
      forgeType: "github",
      projectContext: metadata ? JSON.stringify(metadata) : null,
    });

    await this.db.insert(chats).values({ id: chatId, sessionId, title });

    const [sessionRow] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!sessionRow) return null;

    const result = await enqueueSessionTriggerJob(this.db, this.queue, {
      sessionRow,
      userId,
      chatTitle: title,
      trigger: "workflow_run",
      fixContext: description,
      modelId: model,
    });

    if (!result) return null;
    return { sessionId, runId: result.runId };
  }

  // -------------------------------------------------------------------------
  // enqueueReviewJob — POST /api/sessions/[id]/review
  // -------------------------------------------------------------------------

  async enqueueReviewJob(
    auth: AuthContext,
    sessionId: string,
    _params: ReviewJobParams = {},
  ): Promise<{ runId: string; chatId: string } | null> {
    const [sessionRow] = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, auth.userId)))
      .limit(1);

    if (!sessionRow) throw new SessionNotFoundError();

    if (!sessionRow.prNumber) {
      throw new ValidationError("No PR associated with this session");
    }

    const reviewContext = [
      `Please review pull request #${sessionRow.prNumber} on ${sessionRow.repoPath}.`,
      `Read the full diff using pull_request_diff, then submit a thorough code review using review_pr.`,
      `Focus on: correctness, potential bugs, performance issues, security concerns, and code style.`,
      `If everything looks good, approve the PR. Otherwise, leave constructive inline comments.`,
    ].join("\n");

    const result = await enqueueSessionTriggerJob(this.db, this.queue, {
      sessionRow,
      userId: auth.userId,
      trigger: "review_comment",
      fixContext: reviewContext,
    });

    if (!result) return null;

    await this.db.insert(prEvents).values({
      id: crypto.randomUUID(),
      userId: auth.userId,
      sessionId,
      repoPath: sessionRow.repoPath ?? "",
      prNumber: sessionRow.prNumber,
      action: "review_requested",
      title: sessionRow.title,
      actionNeeded: false,
      read: true,
      metadata: { runId: result.runId, triggeredBy: "user" },
    });

    return result;
  }
}

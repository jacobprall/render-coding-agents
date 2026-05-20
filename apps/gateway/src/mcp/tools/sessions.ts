import { z } from "zod";
import type { ToolRegistrar } from "./helpers";
import { textResult } from "./helpers";

export const registerSessionTools: ToolRegistrar = (server, p, auth) => {
  server.registerTool("create-session", {
    title: "Create Session",
    description: "Create a new agent session. Optionally attach to a repo/branch or a project.",
    inputSchema: z.object({
      repoPath: z.string().optional().describe("Repository path (e.g. owner/repo)"),
      branch: z.string().optional().describe("Git branch name"),
      baseBranch: z.string().optional().describe("Base branch to diverge from"),
      title: z.string().optional().describe("Session title"),
      forgeType: z.enum(["github", "gitlab"]).optional(),
      firstMessage: z.string().optional().describe("Send an initial message immediately"),
      modelId: z.string().optional().describe("LLM model to use"),
      projectId: z.string().optional().describe("Attach to an existing project"),
    }),
  }, async (args) => {
    const branch = args.repoPath ? (args.branch || args.baseBranch || "main") : undefined;

    const result = await p.sessions.create(auth, { ...args, branch });
    return textResult(result);
  });

  server.registerTool("send-message", {
    title: "Send Message",
    description: "Send a message to an agent session to start or continue work.",
    inputSchema: z.object({
      sessionId: z.string(),
      content: z.string().describe("The message content"),
      modelId: z.string().optional().describe("LLM model to use"),
    }),
  }, async ({ sessionId, content, modelId }) => {
    const result = await p.sessions.sendMessage(auth, sessionId, { content, modelId });
    return textResult(result);
  });

  server.registerTool("reply-to-agent", {
    title: "Reply to Agent",
    description: "Reply to an agent's tool call (e.g. ask_user response).",
    inputSchema: z.object({
      sessionId: z.string(),
      toolCallId: z.string(),
      message: z.string(),
      runId: z.string().optional(),
    }),
  }, async ({ sessionId, toolCallId, message, runId }) => {
    await p.sessions.reply(auth, sessionId, { toolCallId, message, runId });
    return textResult({ ok: true });
  });

  server.registerTool("stop-session", {
    title: "Stop Session",
    description: "Stop the running agent in a session.",
    inputSchema: z.object({ sessionId: z.string() }),
  }, async ({ sessionId }) => {
    const result = await p.sessions.stop(auth, sessionId);
    return textResult(result);
  });

  server.registerTool("archive-session", {
    title: "Archive Session",
    description: "Archive (soft-delete) a session.",
    inputSchema: z.object({ sessionId: z.string() }),
  }, async ({ sessionId }) => {
    await p.sessions.archive(auth, sessionId);
    return textResult({ ok: true });
  });

  server.registerTool("update-session-phase", {
    title: "Update Session Phase",
    description: "Update the phase of a session (e.g. coding, reviewing, deploying).",
    inputSchema: z.object({
      sessionId: z.string(),
      phase: z.string().describe("New phase name"),
    }),
  }, async ({ sessionId, phase }) => {
    await p.sessions.updatePhase(auth, sessionId, phase);
    return textResult({ ok: true });
  });

  server.registerTool("update-session-config", {
    title: "Update Session Config",
    description: "Patch the configuration of a session.",
    inputSchema: z.object({
      sessionId: z.string(),
      config: z.record(z.string(), z.unknown()).describe("Key-value pairs to merge into session config"),
    }),
  }, async ({ sessionId, config }) => {
    const result = await p.sessions.updateConfig(auth, sessionId, config);
    return textResult(result);
  });

  server.registerTool("get-session-skills", {
    title: "Get Session Skills",
    description: "List the skills currently active in a session.",
    inputSchema: z.object({ sessionId: z.string() }),
  }, async ({ sessionId }) => {
    const skills = await p.sessions.getSkills(auth, sessionId);
    return textResult(skills);
  });

  server.registerTool("update-session-skills", {
    title: "Update Session Skills",
    description: "Replace the set of active skills in a session.",
    inputSchema: z.object({
      sessionId: z.string(),
      skills: z.array(z.object({
        source: z.enum(["builtin", "user", "repo"]),
        slug: z.string(),
      })),
    }),
  }, async ({ sessionId, skills }) => {
    await p.sessions.updateSkills(auth, sessionId, skills);
    return textResult({ ok: true });
  });

  server.registerTool("session-spec-action", {
    title: "Session Spec Action",
    description: "Approve or reject a spec produced by a session.",
    inputSchema: z.object({
      sessionId: z.string(),
      specId: z.string(),
      action: z.enum(["approve", "reject"]),
      rejectionNote: z.string().optional(),
    }),
  }, async ({ sessionId, ...data }) => {
    const result = await p.sessions.handleSpecAction(auth, sessionId, data);
    return textResult(result);
  });

  server.registerTool("auto-title-session", {
    title: "Auto-Title Session",
    description: "Generate an automatic title for a session based on its conversation.",
    inputSchema: z.object({ sessionId: z.string() }),
  }, async ({ sessionId }) => {
    const result = await p.sessions.generateAutoTitle(sessionId, auth.userId);
    return textResult(result);
  });

  server.registerTool("list-ci-events", {
    title: "List CI Events",
    description: "List CI events (build/test runs) for a session.",
    inputSchema: z.object({ sessionId: z.string() }),
  }, async ({ sessionId }) => {
    const events = await p.sessions.listCiEvents(auth, sessionId);
    return textResult(events);
  });

  server.registerTool("enqueue-review", {
    title: "Enqueue Review",
    description: "Enqueue a code review job for a session.",
    inputSchema: z.object({
      sessionId: z.string(),
      fixContext: z.string().optional().describe("Additional context for the reviewer"),
    }),
  }, async ({ sessionId, fixContext }) => {
    const result = await p.sessions.enqueueReviewJob(auth, sessionId, fixContext ? { fixContext } : undefined);
    return textResult(result ?? { ok: true });
  });
};

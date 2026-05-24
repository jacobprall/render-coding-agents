import { mock } from "bun:test";

const t = (name: string) => ({ table: name });

mock.module("@coding-agents/db", () => ({
  agentRuns: t("agentRuns"), chats: t("chats"), chatMessages: t("chatMessages"),
  sessions: t("sessions"), specs: t("specs"), prEvents: t("prEvents"),
  projects: t("projects"), projectRepos: t("projectRepos"), users: t("users"),
  accounts: t("accounts"), orgs: t("orgs"), syncConnections: t("syncConnections"),
  mirrors: t("mirrors"), llmApiKeys: t("llmApiKeys"), apiKeys: t("apiKeys"),
  usageEvents: t("usageEvents"), llmCalls: t("llmCalls"), budgets: t("budgets"),
  userPreferences: t("userPreferences"), skillCache: t("skillCache"),
  infraSpecs: t("infraSpecs"), infraResources: t("infraResources"),
  infraActions: t("infraActions"), infraObservations: t("infraObservations"),
  eventSeries: t("eventSeries"), agentEvents: t("agentEvents"), ciEvents: t("ciEvents"),
  webhookDeliveries: t("webhookDeliveries"), mirrorSyncLog: t("mirrorSyncLog"),
  invites: t("invites"), verificationTokens: t("verificationTokens"),
  verificationResults: t("verificationResults"),
  OBSERVABILITY_EVENT_TYPES: ["llm_request", "tool_call", "sandbox_exec", "error", "system"],
  OBSERVABILITY_EVENT_STATUSES: ["running", "success", "error", "timeout", "interrupted"],
}));

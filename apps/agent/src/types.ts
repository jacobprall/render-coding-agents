import type { StreamEvent } from "@coding-agents/shared";
import type { ResolvedSkill } from "./skills";

export type { StreamEvent, ResolvedSkill };

export type AssistantPart = Record<string, unknown>;

export interface AgentJob {
  runId: string;
  chatId: string;
  sessionId: string;
  userId: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  modelMessages?: unknown[];
  resolvedSkills: ResolvedSkill[];
  projectConfig?: unknown;
  projectContext?: string | null;
  modelId?: string;
  fixContext?: string;
  requestId?: string;
  retryCount?: number;
  maxRetries?: number;
  trigger?:
    | "user_message"
    | "ci_failure"
    | "review_comment"
    | "pr_opened"
    | "pr_merged"
    | "workflow_run"
    | "deploy_failure";
  workspaceId?: string;
  resolvedEnv?: Record<string, string>;
  resolvedSecrets?: Record<string, string>;
  forgeUsername?: string;
  repos?: Array<{
    repoPath: string;
    forgeType: "github" | "gitlab" | null;
    defaultBranch: string;
    isPrimary: boolean;
  }>;
  /** Pre-fetched session row fields, avoids re-querying the DB in the worker. */
  sessionContext?: {
    repoPath: string | null;
    branch: string | null;
    baseBranch: string | null;
    title: string;
    forgeType: string | null;
    projectId: string | null;
  };
}

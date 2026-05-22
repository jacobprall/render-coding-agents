export interface SecretsConfig {
  env?: Record<string, string>
  runtime?: Record<string, string>
  build?: Record<string, string>
}

export interface RepoMirrorStatus {
  [repoPath: string]: {
    status: "initializing" | "ready" | "syncing" | "stale" | "error"
    lastFetchedAt: string | null
    sizeBytes: number
    errorMessage?: string
    diskPath?: string
  }
}

export interface SessionSummary {
  outcome: "completed" | "failed" | "aborted"
  durationMs: number
  reposTouched: string[]
  prUrls: string[]
  linesAdded: number
  linesRemoved: number
  toolCallCount: number
  llmCostUsd: number
  completedAt: string
}

export interface WorkspaceConfig {
  environmentConfig: Record<string, string>
  secretsConfig: SecretsConfig
  computeDefaults: Record<string, unknown>
  defaultSkills: Array<{ source: "builtin" | "user" | "repo"; slug: string }>
}

export interface ResolvedWorkspaceConfig extends WorkspaceConfig {
  repos: Array<{
    repoPath: string
    forgeType: "github" | "gitlab" | null
    defaultBranch: string
    isPrimary: boolean
  }>
}

export type MirrorSyncTrigger = "webhook" | "cron" | "session_init" | "manual"
export type MirrorSyncStatus = "success" | "failed"

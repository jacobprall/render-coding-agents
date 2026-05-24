# Internal Interface Contracts: Agent Module Audit Remediation

**Date**: 2026-05-22 | **Feature**: 008-agent-audit

These are internal module interfaces within `apps/agent`. The agent module does not expose public APIs to external consumers — it is a worker process that consumes jobs from Redis Streams. These contracts document the interfaces between decomposed internal modules.

## 1. turn-orchestrator.ts — Public Entry Point

```typescript
/**
 * Execute a single agent turn: claim run, provision sandbox, set up workspace,
 * run the LLM loop, create PRs for changed repos, and finalize status.
 *
 * This is the only public entry point for the agent module.
 * Called by worker.ts after job resolution.
 */
export async function runAgentTurn(
  job: AgentJob,
  redis: Redis,
  platform: PlatformContainer,
): Promise<void>;
```

**Contract**: Signature unchanged from current `agent.ts`. `worker.ts` import path changes from `./agent` to `./agent` (re-export) — no consumer change needed.

## 2. workspace.ts — Workspace Setup

```typescript
/**
 * Set up the agent workspace: scratch mode, single-repo clone,
 * or multi-repo worktree configuration.
 */
export async function setupWorkspace(params: {
  job: AgentJob;
  db: PlatformDb;
  adapter: SandboxAdapter;
  forge: ForgeProvider;
  events: EventBus;
}): Promise<WorkspaceResult>;

interface WorkspaceResult {
  mode: "scratch" | "single" | "multi";
  primaryRepoPath?: string;
  repos?: Array<{ name: string; path: string }>;
}

/**
 * Clone a single repository into a subdirectory of the workspace.
 * Handles mirror-backed worktrees with fallback to direct clone.
 */
export async function cloneRepoIntoSubdir(params: {
  adapter: SandboxAdapter;
  db: PlatformDb;
  job: AgentJob;
  repoPath: string;
  cloneUrl: string;
  branch: string;
  baseBranch: string;
  targetDir: string;
}): Promise<void>;
```

## 3. pr-manager.ts — PR Creation and Push

```typescript
/**
 * For each repo with changes, push the branch and create a PR.
 * Returns the URLs of created PRs.
 */
export async function createPrsForChangedRepos(params: {
  job: AgentJob;
  db: PlatformDb;
  adapter: SandboxAdapter;
  forge: ForgeProvider;
  events: EventBus;
  repos: Array<{ name: string; path: string }>;
}): Promise<string[]>;

/**
 * Get diff statistics for a repository path.
 */
export async function getDiffStats(
  adapter: SandboxAdapter,
  repoPath: string,
): Promise<{ filesChanged: number; insertions: number; deletions: number }>;
```

## 4. lib/shell-escape.ts — Shell Escaping Utility

```typescript
/**
 * Escape a string for safe inclusion in a POSIX shell command.
 * Uses single-quote wrapping with escaped embedded quotes.
 *
 * @throws Error if input contains null bytes
 * @returns POSIX-safe single-quoted shell literal
 */
export function shellEscape(s: string): string;
```

## 5. system-prompt.ts — Extended Options

```typescript
interface SystemPromptOpts {
  skillIndex?: SkillSummary[];
  /** Full content of resolved skills, injected after the skill index table. */
  resolvedSkillContents?: Array<{ slug: string; content: string }>;
  projectContext?: string | null;
  projectConfig?: unknown;
  forgeLabel?: string;
  isScratch?: boolean;
}

export function buildAgentSystemPrompt(opts: SystemPromptOpts): string;
```

## 6. tools/task.ts — Extended Constructor

```typescript
export function taskTool(
  publishFn: (event: StreamEvent) => Promise<void>,
  buildSubTools: () => Record<string, ToolConfig>,
  modelResolver: SubagentModelResolver,
  forgeContext: ForgeAgentContext,
  parentSystemPromptSuffix?: string,
  parentSignals?: {
    signal?: AbortSignal;
    recorder?: ObservabilityRecorder;
    secrets?: Record<string, string>;
    resultStore?: Map<string, string>;
  },
): ReturnType<typeof defineTool>;
```

**Contract**: The 6th parameter is optional — existing call sites that don't pass it continue to work (subagent runs without parent signals, matching current behavior).

## 7. providers.ts — Parameterized Forge Type

```typescript
/**
 * Build a ForgeProvider for the session's user.
 * Queries sync connections using the session's declared forge type.
 */
export async function getForgeProviderForSession(
  db: PlatformDb,
  session: { forgeType: string | null; userId: string },
): Promise<ForgeProvider>;
```

**Contract**: Signature unchanged. Behavior change: uses `session.forgeType ?? "github"` in the DB query instead of hardcoded `"github"`.

import { eq } from "drizzle-orm";
import { agentRuns, sessions, prEvents } from "@coding-agents/db";
import type { SessionSummary } from "@coding-agents/shared";
import type { PlatformDb } from "@coding-agents/platform";
import type { SandboxAdapter } from "@coding-agents/sandbox";
import type { ForgeAgentContext } from "./context/agent-context";
import { getForgeProviderForSession } from "./providers";
import { shellEscape } from "./lib/shell-escape";
import type { AgentJob, AssistantPart } from "./types";
import { repoNameFromPath } from "./workspace";

export function countToolCalls(parts: AssistantPart[]): number {
  return parts.filter((p) => p.type === "tool_call").length;
}

async function collectGitLineStats(
  adapter: SandboxAdapter,
  sessionId: string,
  repoRelDir: string | null,
  baseBranch: string,
): Promise<{ added: number; removed: number; hasChanges: boolean }> {
  const gitPrefix = repoRelDir ? `git -C ${shellEscape(repoRelDir)}` : "git";
  await adapter.exec(sessionId, `${gitPrefix} fetch origin ${shellEscape(baseBranch)} 2>/dev/null || true`).catch(() => {});

  const originRef = shellEscape(`origin/${baseBranch}`);
  const diffResult = await adapter
    .exec(sessionId, `${gitPrefix} diff --numstat ${originRef}...HEAD 2>/dev/null || ${gitPrefix} diff --numstat HEAD~1..HEAD 2>/dev/null || true`)
    .catch(() => ({ stdout: "", exitCode: 1 }));

  let added = 0;
  let removed = 0;
  for (const line of diffResult.stdout.split("\n")) {
    const [a, d] = line.split("\t");
    if (a && d && a !== "-" && d !== "-") {
      added += parseInt(a, 10) || 0;
      removed += parseInt(d, 10) || 0;
    }
  }

  const hasChanges = added > 0 || removed > 0;
  return { added, removed, hasChanges };
}

async function pushRepoBranch(params: {
  adapter: SandboxAdapter;
  forge: Awaited<ReturnType<typeof getForgeProviderForSession>>;
  sessionId: string;
  repoRelDir: string | null;
  repoPath: string;
  branch: string;
}): Promise<{ ok: boolean; stderr: string }> {
  const { adapter, forge, sessionId, repoRelDir, repoPath, branch } = params;
  const [owner, repo] = repoPath.split("/");
  if (!owner || !repo) return { ok: false, stderr: "invalid repo path" };

  const authUrl = forge.git.authenticatedCloneUrl(owner, repo);
  const gitPrefix = repoRelDir ? `git -C ${shellEscape(repoRelDir)}` : "git";

  const pushResult = await adapter.exec(
    sessionId,
    `${gitPrefix} push -u ${shellEscape(authUrl)} ${shellEscape(branch)}`,
  );
  return { ok: pushResult.exitCode === 0, stderr: pushResult.stderr };
}

export async function createPrsForChangedRepos(params: {
  job: AgentJob;
  db: PlatformDb;
  adapter: SandboxAdapter;
  sessionRow: { title: string; branch: string | null; baseBranch: string | null; repoPath: string | null; forgeType: string | null; userId: string };
  forgeContext: ForgeAgentContext;
}): Promise<{ prUrls: string[]; reposTouched: string[]; linesAdded: number; linesRemoved: number }> {
  const { job, db, adapter, sessionRow, forgeContext } = params;
  const branch = sessionRow.branch ?? `agent/${job.sessionId}`;
  const baseBranch = sessionRow.baseBranch ?? "main";
  const prUrls: string[] = [];
  const reposTouched: string[] = [];
  let linesAdded = 0;
  let linesRemoved = 0;

  const repoEntries =
    job.repos?.map((r) => ({
      repoPath: r.repoPath,
      relDir: `repos/${repoNameFromPath(r.repoPath)}`,
      isPrimary: r.isPrimary,
      defaultBranch: r.defaultBranch,
    })) ??
    (sessionRow.repoPath
      ? [{ repoPath: sessionRow.repoPath, relDir: null as string | null, isPrimary: true, defaultBranch: baseBranch }]
      : []);

  for (const entry of repoEntries) {
    const base = entry.defaultBranch || baseBranch;
    const stats = await collectGitLineStats(adapter, job.sessionId, entry.relDir, base);
    linesAdded += stats.added;
    linesRemoved += stats.removed;
    if (!stats.hasChanges) continue;

    reposTouched.push(entry.repoPath);
    const [owner, repo] = entry.repoPath.split("/");
    if (!owner || !repo) continue;

    const push = await pushRepoBranch({
      adapter,
      forge: forgeContext.forge,
      sessionId: job.sessionId,
      repoRelDir: entry.relDir,
      repoPath: entry.repoPath,
      branch,
    });
    if (!push.ok) {
      console.warn(`[pr] push failed for ${entry.repoPath}: ${push.stderr}`);
      continue;
    }

    try {
      const pr = await forgeContext.forge.pulls.create({
        owner,
        repo,
        head: branch,
        base,
        title: sessionRow.title || `Agent changes (${entry.repoPath})`,
        body: `Automated PR from agent session ${job.sessionId}.`,
      });
      prUrls.push(pr.htmlUrl);

      if (entry.isPrimary) {
        await forgeContext.onPrCreated?.({ prNumber: pr.number, prStatus: "open" });
      } else {
        await db.insert(prEvents).values({
          id: crypto.randomUUID(),
          userId: job.userId,
          sessionId: job.sessionId,
          repoPath: entry.repoPath,
          prNumber: pr.number,
          action: "opened",
          title: sessionRow.title ?? "PR",
          actionNeeded: true,
          metadata: { createdByAgent: true, runId: job.runId },
        });
      }
    } catch (err) {
      console.warn(`[pr] create failed for ${entry.repoPath}:`, err instanceof Error ? err.message : err);
    }
  }

  return { prUrls, reposTouched, linesAdded, linesRemoved };
}

export async function persistSessionSummary(params: {
  db: PlatformDb;
  job: AgentJob;
  outcome: SessionSummary["outcome"];
  assistantParts: AssistantPart[];
  prUrls: string[];
  reposTouched: string[];
  linesAdded: number;
  linesRemoved: number;
}): Promise<void> {
  const { db, job, outcome, assistantParts, prUrls, reposTouched, linesAdded, linesRemoved } = params;

  const [runRow] = await db
    .select({ startedAt: agentRuns.startedAt, totalDurationMs: agentRuns.totalDurationMs, costUsd: agentRuns.costUsd })
    .from(agentRuns)
    .where(eq(agentRuns.id, job.runId))
    .limit(1);

  const durationMs =
    runRow?.totalDurationMs ??
    (runRow?.startedAt ? Date.now() - runRow.startedAt.getTime() : 0);

  const summary: SessionSummary = {
    outcome,
    durationMs,
    reposTouched: reposTouched.length > 0
      ? reposTouched
      : job.repos?.map((r) => r.repoPath) ?? [],
    prUrls,
    linesAdded,
    linesRemoved,
    toolCallCount: countToolCalls(assistantParts),
    llmCostUsd: runRow?.costUsd ? parseFloat(String(runRow.costUsd)) : 0,
    completedAt: new Date().toISOString(),
  };

  await db
    .update(sessions)
    .set({ summary, linesAdded, linesRemoved, updatedAt: new Date() })
    .where(eq(sessions.id, job.sessionId));
}

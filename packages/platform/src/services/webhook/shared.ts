import { and, desc, eq } from "drizzle-orm";
import { sessions } from "@coding-agents/db";
import type { PlatformDb } from "../../interfaces/database";
import type { QueueAdapter } from "../../interfaces/queue";
import type { EventBus } from "../../interfaces/events";
import type { CIService } from "../ci";

// ---------------------------------------------------------------------------
// Shared dependency bundle passed to each per-provider handler
// ---------------------------------------------------------------------------

export interface WebhookDeps {
  db: PlatformDb;
  queue: QueueAdapter;
  events: EventBus;
  ciService: CIService;
}

// ---------------------------------------------------------------------------
// DB query helpers
// ---------------------------------------------------------------------------

export function findSessionsForRepoBranch(db: PlatformDb, repoPath: string, branch: string) {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.repoPath, repoPath), eq(sessions.branch, branch)))
    .orderBy(desc(sessions.updatedAt));
}

export function findSessionsForPr(db: PlatformDb, repoPath: string, prNumber: number) {
  return db
    .select()
    .from(sessions)
    .where(and(eq(sessions.repoPath, repoPath), eq(sessions.prNumber, prNumber)))
    .orderBy(desc(sessions.updatedAt));
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function repoFullName(repository: unknown): string | undefined {
  if (!repository || typeof repository !== "object") return undefined;
  const r = repository as Record<string, unknown>;
  const full =
    typeof r.full_name === "string"
      ? r.full_name
      : typeof r.fullName === "string"
        ? (r.fullName as string)
        : undefined;
  return full;
}

export function branchFromPushRef(ref: unknown): string | undefined {
  if (typeof ref !== "string") return undefined;
  return ref.replace(/^refs\/heads\//, "");
}

export function parseRepoPath(fullPath: string): { owner: string; repo: string } | null {
  const parts = fullPath.trim().split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  const [owner, repo] = parts;
  return owner && repo ? { owner, repo } : null;
}

export function sessionWantsAutoMerge(projectConfig: unknown): boolean {
  if (!projectConfig || typeof projectConfig !== "object") return false;
  const c = projectConfig as Record<string, unknown>;
  return c.autoMerge === true || c.auto_merge === true;
}

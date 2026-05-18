import {
  ensureUserSkillsRepo,
  FORGE_SKILLS_REPO_NAME,
  listBuiltinSummaries,
  listRepoSkillSummaries,
  listUserSkillSummaries,
  parseSkillMarkdown,
} from "@openforge/skills";
import type { SkillSummary } from "@openforge/skills";
import { ValidationError } from "@openforge/shared";
import type { AuthContext } from "../interfaces/auth";
import { getForgeProviderForAuth } from "../forge/factory";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_SKILLS_DIR = "skills";

// ---------------------------------------------------------------------------
// Parameter and result types
// ---------------------------------------------------------------------------

export interface ListSkillsResult {
  builtins: SkillSummary[];
  user: SkillSummary[];
  repo: SkillSummary[];
}

export interface InstallSkillParams {
  url: string;
  name?: string;
}

export interface InstallSkillResult {
  ok: boolean;
  slug: string;
  name: string;
  description: string | undefined;
}

export interface ListRepoSkillsResult {
  repo: string;
  skills: SkillSummary[];
}

// ---------------------------------------------------------------------------
// SkillService
// ---------------------------------------------------------------------------

export class SkillService {
  // -------------------------------------------------------------------------
  // listSkills — GET /api/skills
  // -------------------------------------------------------------------------

  async listSkills(
    auth: AuthContext,
    repoPath?: string,
  ): Promise<ListSkillsResult> {
    const forge = getForgeProviderForAuth(auth);

    await ensureUserSkillsRepo(forge, auth.username);

    const builtins = listBuiltinSummaries();
    const user = await listUserSkillSummaries(forge, auth.username);
    const repo = repoPath ? await listRepoSkillSummaries(forge, repoPath) : [];

    return { builtins, user, repo };
  }

  // -------------------------------------------------------------------------
  // installSkill — POST /api/skills/install
  // -------------------------------------------------------------------------

  async installSkill(
    auth: AuthContext,
    params: InstallSkillParams,
  ): Promise<InstallSkillResult> {
    const { url, name } = params;
    if (!url?.trim()) {
      throw new ValidationError("URL is required");
    }

    const rawUrl = toRawUrl(url.trim());
    validateExternalUrl(rawUrl);

    let markdown: string;
    const res = await fetch(rawUrl, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      throw new ValidationError(`Failed to fetch skill: ${res.status} ${res.statusText}`);
    }
    markdown = await res.text();

    const parsed = parseSkillMarkdown(markdown);
    if (!parsed.body.trim()) {
      throw new ValidationError(
        "Fetched content doesn't look like a valid skill (no body)",
      );
    }

    const slug =
      name?.trim() ||
      parsed.name?.toLowerCase().replace(/\s+/g, "-") ||
      slugFromUrl(url);

    const forge = getForgeProviderForAuth(auth);
    await ensureUserSkillsRepo(forge, auth.username);

    const filePath = `${USER_SKILLS_DIR}/${slug}.md`;

    try {
      await forge.files.createFile(auth.username, FORGE_SKILLS_REPO_NAME, filePath, {
        content: markdown,
        message: `install skill: ${parsed.name || slug}`,
      });
    } catch {
      const existing = await forge.files.getContents(
        auth.username,
        FORGE_SKILLS_REPO_NAME,
        filePath,
      );
      const sha = Array.isArray(existing) ? undefined : existing.sha;
      await forge.files.putFile(auth.username, FORGE_SKILLS_REPO_NAME, filePath, {
        content: markdown,
        message: `update skill: ${parsed.name || slug}`,
        sha,
      });
    }

    return {
      ok: true,
      slug,
      name: parsed.name || slug,
      description: parsed.description,
    };
  }

  // -------------------------------------------------------------------------
  // syncSkills — POST /api/skills/sync
  // -------------------------------------------------------------------------

  async syncSkills(auth: AuthContext): Promise<void> {
    const forge = getForgeProviderForAuth(auth);
    await ensureUserSkillsRepo(forge, auth.username);
  }

  // -------------------------------------------------------------------------
  // listRepoSkills — GET /api/skills/repo/[...path]
  // -------------------------------------------------------------------------

  async listRepoSkills(
    auth: AuthContext,
    owner: string,
    repo: string,
  ): Promise<ListRepoSkillsResult> {
    const repoPath = `${owner}/${repo}`;
    const forge = getForgeProviderForAuth(auth);
    const skills = await listRepoSkillSummaries(forge, repoPath);
    return { repo: repoPath, skills };
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function validateExternalUrl(urlStr: string): URL {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new ValidationError(`Invalid URL: ${urlStr}`);
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ValidationError(`URL must use http or https protocol`);
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  ) {
    throw new ValidationError("URL must not point to localhost");
  }

  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const octets = parts.map(Number);
    const [a, b] = octets;
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0 ||
      a === 127
    ) {
      throw new ValidationError("URL must not point to private or reserved IP ranges");
    }
  }

  return url;
}

function toRawUrl(url: string): string {
  const gh = url.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/,
  );
  if (gh) {
    return `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${gh[3]}/${gh[4]}`;
  }
  return url;
}

function slugFromUrl(url: string): string {
  const segments = url.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? "skill";
  return last
    .replace(/\.md$/i, "")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .toLowerCase();
}

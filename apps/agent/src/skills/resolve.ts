import type { ForgeFileContent, ForgeProvider } from "@openforge/shared";
import {
  decodeForgeFileContent,
  getBuiltinRaw,
  skillMarkdownToResolved,
} from "./builtins";
import { parseSkillMarkdown } from "./parse";
import type { ActiveSkillRef, ResolvedSkill, SkillSource, SkillSummary } from "./types";

export const FORGE_SKILLS_REPO_NAME = "openforge-skills";
/** Skills in the user repo live under this directory. */
export const USER_SKILLS_DIR = "skills";
/** Repo-level skills path in project repos. */
export const REPO_SKILLS_PATH = ".forge/skills";

export const DEFAULT_ACTIVE_SKILL_REFS: ActiveSkillRef[] = [
  { source: "builtin", slug: "react-best-practices" },
  { source: "builtin", slug: "next-best-practices" },
];

function splitRepoPath(full: string): { owner: string; repo: string } | null {
  const [owner, repo] = full.split("/");
  if (!owner || !repo) return null;
  return { owner, repo };
}

async function readSkillFileFromRepo(
  forge: ForgeProvider,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<string | null> {
  try {
    const res = await forge.files.getContents(owner, repo, path, ref);
    if (Array.isArray(res)) return null;
    if (res.type !== "file") return null;
    return decodeForgeFileContent(res.content, res.encoding);
  } catch {
    return null;
  }
}

export async function listMdSlugsInRepoPath(
  forge: ForgeProvider,
  owner: string,
  repo: string,
  dirPath: string,
  ref?: string,
): Promise<string[]> {
  try {
    const res = await forge.files.getContents(owner, repo, dirPath, ref);
    if (!Array.isArray(res)) return [];
    return res
      .filter((e: ForgeFileContent) => e.type === "file" && e.name.endsWith(".md"))
      .map((e) => e.name.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

export async function listRepoSkillSummaries(
  forge: ForgeProvider,
  projectRepoPath: string,
  ref?: string,
): Promise<SkillSummary[]> {
  const pr = splitRepoPath(projectRepoPath);
  if (!pr) return [];
  const slugs = await listMdSlugsInRepoPath(forge, pr.owner, pr.repo, REPO_SKILLS_PATH, ref);
  const out: SkillSummary[] = [];
  for (const slug of slugs) {
    const raw = await readSkillFileFromRepo(
      forge,
      pr.owner,
      pr.repo,
      `${REPO_SKILLS_PATH}/${slug}.md`,
      ref,
    );
    if (!raw) continue;
    const p = parseSkillMarkdown(raw);
    out.push({
      source: "repo",
      slug,
      name: p.name || slug,
      description: p.description,
      defaultEnabled: true,
    });
  }
  return out;
}

export async function listUserSkillSummaries(
  forge: ForgeProvider,
  forgeUsername: string,
  ref?: string,
): Promise<SkillSummary[]> {
  const slugs = await listMdSlugsInRepoPath(
    forge,
    forgeUsername,
    FORGE_SKILLS_REPO_NAME,
    USER_SKILLS_DIR,
    ref,
  );
  const out: SkillSummary[] = [];
  for (const slug of slugs) {
    const raw = await readSkillFileFromRepo(
      forge,
      forgeUsername,
      FORGE_SKILLS_REPO_NAME,
      `${USER_SKILLS_DIR}/${slug}.md`,
      ref,
    );
    if (!raw) continue;
    const p = parseSkillMarkdown(raw);
    out.push({
      source: "user",
      slug,
      name: p.name || slug,
      description: p.description,
      defaultEnabled: p.defaultEnabled,
    });
  }
  return out;
}

/**
 * Merge session-stored active skill refs with defaults when empty or null.
 * Repo skills default to active unless the stored list explicitly omitted them (stored list is authoritative).
 */
export function normalizeActiveSkills(
  stored: ActiveSkillRef[] | null | undefined,
  repoDefaultSlugs: string[],
): ActiveSkillRef[] {
  if (stored && stored.length > 0) {
    return stored;
  }
  const base = [...DEFAULT_ACTIVE_SKILL_REFS];
  for (const slug of repoDefaultSlugs) {
    if (!base.some((r) => r.source === "repo" && r.slug === slug)) {
      base.push({ source: "repo", slug });
    }
  }
  return base;
}

export async function resolveActiveSkills(
  forge: ForgeProvider,
  params: {
    activeSkills: ActiveSkillRef[];
    forgeUsername: string;
    projectRepoPath: string;
    /** branch / ref for repo skills */
    ref?: string;
  },
): Promise<ResolvedSkill[]> {
  const { activeSkills, forgeUsername, projectRepoPath, ref } = params;
  const proj = splitRepoPath(projectRepoPath);
  const resolved: ResolvedSkill[] = [];

  for (const refItem of activeSkills) {
    let raw: string | null = null;
    const { source, slug } = refItem;

    if (source === "builtin") {
      raw = getBuiltinRaw(slug);
      if (!raw) {
        console.warn(`[skills] missing builtin slug=${slug}`);
        continue;
      }
      resolved.push(skillMarkdownToResolved("builtin", slug, raw));
      continue;
    }

    if (source === "user") {
      if (!forgeUsername) {
        console.warn(`[skills] skip user skill slug=${slug} (no forgeUsername)`);
        continue;
      }
      raw = await readSkillFileFromRepo(
        forge,
        forgeUsername,
        FORGE_SKILLS_REPO_NAME,
        `${USER_SKILLS_DIR}/${slug}.md`,
        ref,
      );
      if (!raw) {
        console.warn(`[skills] missing user skill slug=${slug}`);
        continue;
      }
      resolved.push(skillMarkdownToResolved("user", slug, raw));
      continue;
    }

    if (source === "repo" && proj) {
      raw = await readSkillFileFromRepo(
        forge,
        proj.owner,
        proj.repo,
        `${REPO_SKILLS_PATH}/${slug}.md`,
        ref,
      );
      if (!raw) {
        console.warn(`[skills] missing repo skill slug=${slug}`);
        continue;
      }
      resolved.push(skillMarkdownToResolved("repo", slug, raw));
    }
  }

  return resolved;
}

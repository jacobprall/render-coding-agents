/**
 * Skill types for session jobs.
 *
 * Skill resolution (loading markdown, reading from repos) happens
 * in the agent worker at runtime. Platform passes activeSkillRefs
 * in the job payload; the agent resolves them to full content.
 */

export type SkillSource = "builtin" | "user" | "repo";

export interface ActiveSkillRef {
  source: SkillSource;
  slug: string;
}

export interface ResolvedSkill {
  slug: string;
  name: string;
  source: SkillSource;
  content: string;
}

export const DEFAULT_ACTIVE_SKILL_REFS: ActiveSkillRef[] = [
  { source: "builtin", slug: "react-best-practices" },
  { source: "builtin", slug: "next-best-practices" },
];

/**
 * Normalize stored active skills, filling defaults when empty.
 */
export function normalizeActiveSkills(
  stored: ActiveSkillRef[] | null | undefined,
  repoDefaultSlugs: string[] = [],
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

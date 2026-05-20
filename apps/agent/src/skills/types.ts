export type SkillSource = "builtin" | "user" | "repo";

export interface ActiveSkillRef {
  source: SkillSource;
  slug: string;
}

export interface ResolvedSkill {
  slug: string;
  name: string;
  source: SkillSource;
  /** Formatted block for system prompt */
  content: string;
}

export interface SkillSummary {
  source: SkillSource;
  slug: string;
  name: string;
  description: string;
  defaultEnabled: boolean;
}

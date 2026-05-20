import { z } from "zod";
import { defineTool } from "./define-tool";
import { getBuiltinRaw } from "../skills/builtins";
import { parseSkillMarkdown } from "../skills/parse";

const loadSkillInputSchema = z.object({
  skill_id: z
    .string()
    .describe("The skill ID from the available skills list (e.g. 'builtin/react-best-practices')"),
});

const skillCache = new Map<string, string>();

export function resetSkillCache(): void {
  skillCache.clear();
}

export function loadSkillTool() {
  return defineTool({
    description:
      "Load the full content of a skill by ID. Use when you need detailed guidance for a specific technology or pattern.",
    inputSchema: loadSkillInputSchema,
    execute: async ({ skill_id }) => {
      const cached = skillCache.get(skill_id);
      if (cached) return cached;

      const [source, ...slugParts] = skill_id.split("/");
      const slug = slugParts.join("/");

      if (!source || !slug) {
        return { error: `Invalid skill ID format: "${skill_id}". Expected "source/slug" (e.g. "builtin/react-best-practices").` };
      }

      if (source === "builtin") {
        const raw = getBuiltinRaw(slug);
        if (!raw) {
          return { error: `Builtin skill "${slug}" not found.` };
        }
        const parsed = parseSkillMarkdown(raw);
        const content = parsed.body;
        skillCache.set(skill_id, content);
        return content;
      }

      return { error: `Skill source "${source}" is not available in this context. Only "builtin" skills can be loaded via this tool.` };
    },
  });
}

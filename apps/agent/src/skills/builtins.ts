import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillMarkdown } from "./parse";
import type { SkillSource, SkillSummary } from "./types";

const _dir = dirname(fileURLToPath(import.meta.url));

export const BUILTINS_DIR = join(_dir, "builtins");

export function loadBuiltinFiles(): Array<{ slug: string; raw: string }> {
  const names = readdirSync(BUILTINS_DIR).filter((f) => f.endsWith(".md"));
  return names.map((f) => ({
    slug: f.replace(/\.md$/, ""),
    raw: readFileSync(join(BUILTINS_DIR, f), "utf-8"),
  }));
}

let _cachedBuiltins: Array<{ slug: string; raw: string }> | null = null;

function getCachedBuiltins(): Array<{ slug: string; raw: string }> {
  if (!_cachedBuiltins) {
    _cachedBuiltins = loadBuiltinFiles();
  }
  return _cachedBuiltins;
}

export function listBuiltinSummaries(): SkillSummary[] {
  return getCachedBuiltins().map(({ slug, raw }) => {
    const p = parseSkillMarkdown(raw);
    return {
      source: "builtin" as const,
      slug,
      name: p.name || slug,
      description: p.description,
      defaultEnabled: p.defaultEnabled,
    };
  });
}

export function getBuiltinRaw(slug: string): string | null {
  const hit = getCachedBuiltins().find((f) => f.slug === slug);
  return hit?.raw ?? null;
}

export function decodeForgeFileContent(
  content: string | undefined,
  encoding: string | undefined,
): string {
  if (!content) return "";
  if (encoding === "base64") {
    return Buffer.from(content, "base64").toString("utf-8");
  }
  return content;
}

export function skillMarkdownToResolved(
  source: SkillSource,
  slug: string,
  raw: string,
): { slug: string; name: string; source: SkillSource; content: string } {
  const p = parseSkillMarkdown(raw);
  const title = p.name || slug;
  const block = [`### ${title} (${source}: \`${slug}\`)`, p.body].join("\n\n");
  return {
    slug,
    name: title,
    source,
    content: block,
  };
}

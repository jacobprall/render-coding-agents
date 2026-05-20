/**
 * Minimal YAML-frontmatter parser for skill files (key: value lines only).
 */
export interface ParsedSkillFile {
  name: string;
  description: string;
  /** When frontmatter has default: "true" / true */
  defaultEnabled: boolean;
  body: string;
}

function parseFrontmatterLines(raw: string): Record<string, string> {
  const data: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      data[m[1]] = v;
    }
  }
  return data;
}

export function parseSkillMarkdown(markdown: string): ParsedSkillFile {
  const trimmed = markdown.trim();
  if (!trimmed.startsWith("---\n")) {
    return {
      name: "",
      description: "",
      defaultEnabled: false,
      body: trimmed,
    };
  }
  const end = trimmed.indexOf("\n---\n", 4);
  if (end === -1) {
    return {
      name: "",
      description: "",
      defaultEnabled: false,
      body: trimmed,
    };
  }
  const fm = trimmed.slice(4, end);
  const body = trimmed.slice(end + 5).trim();
  const data = parseFrontmatterLines(fm);
  const defRaw = (data.default ?? "").toLowerCase();
  const defaultEnabled = defRaw === "true" || defRaw === "yes" || defRaw === "1";
  return {
    name: data.name ?? "",
    description: data.description ?? "",
    defaultEnabled,
    body,
  };
}

const FILE_ICON_COLORS: Record<string, string> = {
  md: "text-[#4ec9b0]",
  mdx: "text-[#4ec9b0]",
  ts: "text-[#3178c6]",
  tsx: "text-[#3178c6]",
  js: "text-[#f0db4f]",
  jsx: "text-[#f0db4f]",
  json: "text-[#cbcb41]",
  css: "text-[#563d7c]",
  html: "text-[#e34c26]",
  py: "text-[#3572a5]",
  rs: "text-[#dea584]",
  go: "text-[#00add8]",
  sh: "text-[#3fb950]",
  bash: "text-[#3fb950]",
  zsh: "text-[#3fb950]",
  yml: "text-[#cb171e]",
  yaml: "text-[#cb171e]",
  toml: "text-[#9c4221]",
  sql: "text-[#e38c00]",
  graphql: "text-[#e535ab]",
  svg: "text-[#ffb13b]",
  png: "text-[#a074c4]",
  jpg: "text-[#a074c4]",
  gif: "text-[#a074c4]",
  lock: "text-[#888888]",
};

const DOTFILE_COLOR = "text-[#888888]";
const DEFAULT_COLOR = "text-[#cccccc]";

export function getFileIconColor(filename: string): string {
  if (filename.startsWith(".")) return DOTFILE_COLOR;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICON_COLORS[ext] ?? DEFAULT_COLOR;
}

export function getFileIconChar(filename: string): string {
  if (filename.startsWith(".")) return "·";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "sh" || ext === "bash" || ext === "zsh") return "$";
  return "♦";
}

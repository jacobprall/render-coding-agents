export const DIFF_MAX_EDIT_LINES = 15;
export const DIFF_LINE_MAX_WIDTH = 80;

export type DiffLine = {
  type: "context" | "addition" | "removal" | "separator";
  lineNumber?: number;
  content: string;
};

export type UnifiedDiffResult = {
  diff: string;
  additions: number;
  removals: number;
};

export function splitLines(content: string): string[] {
  if (!content) return [];
  const lines = content.split("\n");
  if (lines.length === 1 && lines[0] === "") return [];
  if (lines.length > 1 && lines[lines.length - 1] === "") {
    return lines.slice(0, -1);
  }
  return lines;
}

export function createEditDiffLines(
  oldString: string,
  newString: string,
  startLine: number = 1,
  maxLines: number = DIFF_MAX_EDIT_LINES,
): { lines: DiffLine[]; additions: number; removals: number } {
  const oldLines = splitLines(oldString);
  const newLines = splitLines(newString);

  const removals = oldLines.length;
  const additions = newLines.length;

  const allLines: DiffLine[] = [];

  oldLines.forEach((line, i) => {
    allLines.push({ type: "removal", lineNumber: startLine + i, content: line });
  });

  newLines.forEach((line, i) => {
    allLines.push({ type: "addition", lineNumber: startLine + i, content: line });
  });

  if (allLines.length <= maxLines) {
    return { lines: allLines, additions, removals };
  }

  const result: DiffLine[] = [];
  const half = Math.floor(maxLines / 2);
  for (let i = 0; i < half; i++) {
    const line = allLines[i];
    if (line) result.push(line);
  }
  result.push({ type: "separator", content: "..." });
  for (let i = allLines.length - half; i < allLines.length; i++) {
    const line = allLines[i];
    if (line) result.push(line);
  }

  return { lines: result, additions, removals };
}

export function createUnifiedDiff(
  oldString: string,
  newString: string,
  filePath: string,
  startLine: number = 1,
): UnifiedDiffResult {
  const oldLines = splitLines(oldString);
  const newLines = splitLines(newString);
  const removals = oldLines.length;
  const additions = newLines.length;
  const safeStartLine = Number.isFinite(startLine) && startLine > 0 ? Math.floor(startLine) : 1;
  const safeFilePath = filePath || "file";
  const diffLines: string[] = [
    `--- a/${safeFilePath}`,
    `+++ b/${safeFilePath}`,
    `@@ -${safeStartLine},${removals} +${safeStartLine},${additions} @@`,
  ];

  for (const line of oldLines) diffLines.push(`-${line}`);
  for (const line of newLines) diffLines.push(`+${line}`);

  return { diff: diffLines.join("\n"), additions, removals };
}

export function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;

  const extToLang: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    md: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    sql: "sql",
    graphql: "graphql",
    vue: "vue",
    svelte: "svelte",
  };

  return extToLang[ext];
}

export type CodeLine = {
  content: string;
  highlighted: string;
};

export const NEW_FILE_MAX_LINES = 200;

export type Highlighter = (code: string, language?: string) => string;

export function createNewFileCodeLines(
  content: string,
  filePath: string,
  highlighter?: Highlighter,
  maxLines: number = NEW_FILE_MAX_LINES,
): { lines: CodeLine[]; totalLines: number; hiddenLines: number } {
  const contentLines = splitLines(content);
  if (contentLines.length === 0) {
    return { lines: [], totalLines: 0, hiddenLines: 0 };
  }

  const totalLines = contentLines.length;
  const linesToShow = contentLines.slice(0, maxLines);
  const hiddenLines = Math.max(0, totalLines - maxLines);
  const language = getLanguageFromPath(filePath);

  const codeToHighlight = linesToShow.join("\n");
  let highlightedCode: string;

  if (highlighter) {
    try {
      highlightedCode = highlighter(codeToHighlight, language);
    } catch {
      highlightedCode = codeToHighlight;
    }
  } else {
    highlightedCode = codeToHighlight;
  }

  const highlightedLines = highlightedCode.split("\n");
  const result: CodeLine[] = linesToShow.map((line, i) => ({
    content: line,
    highlighted: highlightedLines[i] ?? line,
  }));

  return { lines: result, totalLines, hiddenLines };
}

import { isForgeAgentContext } from "../context/agent-context";

const DIFF_PREVIEW_MAX_LINES = 200;
const HUNK_CONTEXT = 3;
const MAX_DIFF_LINES = 5000;

function toLines(text: string): string[] {
  if (text === "") return [];
  return text.split("\n");
}

type DiffOp =
  | { type: "equal"; line: string }
  | { type: "delete"; line: string }
  | { type: "insert"; line: string };

function buildEditScript(oldLines: string[], newLines: string[]): DiffOp[] {
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = m;
  let j = n;
  const reversed: DiffOp[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ type: "equal", line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      reversed.push({ type: "insert", line: newLines[j - 1] });
      j--;
    } else {
      reversed.push({ type: "delete", line: oldLines[i - 1] });
      i--;
    }
  }
  reversed.reverse();
  return reversed;
}

function countFromOps(ops: DiffOp[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === "insert") additions++;
    else if (op.type === "delete") deletions++;
  }
  return { additions, deletions };
}

function countDiffSimple(before: string, after: string): { additions: number; deletions: number } {
  const oldLines = toLines(before);
  const newLines = toLines(after);
  return { additions: Math.max(0, newLines.length - oldLines.length), deletions: Math.max(0, oldLines.length - newLines.length) };
}

interface UnifiedLine {
  prefix: " " | "-" | "+";
  text: string;
  oldNum: number;
  newNum: number;
}

function opsToUnifiedLines(ops: DiffOp[]): UnifiedLine[] {
  let oldLine = 1;
  let newLine = 1;
  const lines: UnifiedLine[] = [];
  for (const op of ops) {
    switch (op.type) {
      case "equal":
        lines.push({ prefix: " ", text: op.line, oldNum: oldLine, newNum: newLine });
        oldLine++;
        newLine++;
        break;
      case "delete":
        lines.push({ prefix: "-", text: op.line, oldNum: oldLine, newNum: newLine });
        oldLine++;
        break;
      case "insert":
        lines.push({ prefix: "+", text: op.line, oldNum: oldLine, newNum: newLine });
        newLine++;
        break;
    }
  }
  return lines;
}

function buildHunkSlices(lines: UnifiedLine[]): UnifiedLine[][] {
  const n = lines.length;
  const isChange = (idx: number) => lines[idx].prefix !== " ";
  const ranges: [number, number][] = [];
  for (let idx = 0; idx < n; idx++) {
    if (!isChange(idx)) continue;
    const start = Math.max(0, idx - HUNK_CONTEXT);
    const end = Math.min(n - 1, idx + HUNK_CONTEXT);
    if (ranges.length > 0 && start <= ranges[ranges.length - 1][1] + 1) {
      ranges[ranges.length - 1][1] = end;
    } else {
      ranges.push([start, end]);
    }
  }
  return ranges.map(([lo, hi]) => lines.slice(lo, hi + 1));
}

function hunkHeader(hunk: UnifiedLine[]): string {
  let oldCount = 0;
  let newCount = 0;
  let oldStart = 0;
  let newStart = 0;
  let oldStartSet = false;
  let newStartSet = false;

  for (const ln of hunk) {
    if (ln.prefix === " " || ln.prefix === "-") {
      oldCount++;
      if (!oldStartSet) {
        oldStart = ln.oldNum;
        oldStartSet = true;
      }
    }
    if (ln.prefix === " " || ln.prefix === "+") {
      newCount++;
      if (!newStartSet) {
        newStart = ln.newNum;
        newStartSet = true;
      }
    }
  }

  if (!oldStartSet) {
    const plus = hunk.find((ln) => ln.prefix === "+");
    if (plus !== undefined) oldStart = plus.oldNum;
  }
  if (!newStartSet) {
    const minus = hunk.find((ln) => ln.prefix === "-");
    if (minus !== undefined) newStart = minus.newNum;
  }

  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
}

function emitHunks(oldLabel: string, newLabel: string, hunks: UnifiedLine[][]): string {
  const parts: string[] = [`--- ${oldLabel}`, `+++ ${newLabel}`];
  for (const hunk of hunks) {
    if (hunk.length === 0) continue;
    parts.push(hunkHeader(hunk));
    for (const ln of hunk) {
      parts.push(`${ln.prefix}${ln.text}`);
    }
  }
  return parts.join("\n");
}

function truncateOutput(unified: string): string {
  const lines = unified.split("\n");
  if (lines.length <= DIFF_PREVIEW_MAX_LINES) return unified;
  const kept = lines.slice(0, DIFF_PREVIEW_MAX_LINES);
  const omitted = lines.length - DIFF_PREVIEW_MAX_LINES;
  return `${kept.join("\n")}\n... (${omitted} more lines truncated)`;
}

export function generateUnifiedDiff(path: string, before: string, after: string): string {
  const oldLines = toLines(before);
  const newLines = toLines(after);

  if (oldLines.length === 0 && newLines.length === 0) {
    return "";
  }

  // Skip expensive LCS for large files to avoid O(m*n) blowup
  if (oldLines.length * newLines.length > MAX_DIFF_LINES * MAX_DIFF_LINES) {
    return `--- a/${path}\n+++ b/${path}\n(diff too large to compute: ${oldLines.length} → ${newLines.length} lines)`;
  }

  let full: string;

  if (oldLines.length === 0) {
    const hunk: UnifiedLine[] = newLines.map((line, i) => ({
      prefix: "+" as const,
      text: line,
      oldNum: 0,
      newNum: i + 1,
    }));
    full = emitHunks("/dev/null", `b/${path}`, [hunk]);
  } else if (newLines.length === 0) {
    const hunk: UnifiedLine[] = oldLines.map((line, i) => ({
      prefix: "-" as const,
      text: line,
      oldNum: i + 1,
      newNum: 0,
    }));
    full = emitHunks(`a/${path}`, "/dev/null", [hunk]);
  } else {
    const ops = buildEditScript(oldLines, newLines);
    const unifiedLines = opsToUnifiedLines(ops);
    const hunks = buildHunkSlices(unifiedLines);
    full =
      hunks.length > 0
        ? emitHunks(`a/${path}`, `b/${path}`, hunks)
        : [`--- a/${path}`, `+++ b/${path}`].join("\n");
  }

  return truncateOutput(full);
}

export async function notifyFileChanged(
  context: unknown,
  path: string,
  before: string,
  after: string,
): Promise<void> {
  if (!isForgeAgentContext(context)) return;
  const cb = context.onFileChanged;
  if (!cb) return;

  const oldLines = toLines(before);
  const newLines = toLines(after);

  let additions: number;
  let deletions: number;

  // Use accurate LCS-based count for reasonable sizes, fallback for large files
  if (oldLines.length * newLines.length <= MAX_DIFF_LINES * MAX_DIFF_LINES) {
    const ops = buildEditScript(oldLines, newLines);
    ({ additions, deletions } = countFromOps(ops));
  } else {
    ({ additions, deletions } = countDiffSimple(before, after));
  }

  await cb({
    path,
    additions,
    deletions,
    unifiedDiffPreview: generateUnifiedDiff(path, before, after),
  });
}

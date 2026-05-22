const SANDBOX_HOST = process.env.SANDBOX_SERVICE_HOST ?? process.env.SANDBOX_URL ?? "http://localhost:3001";
const SANDBOX_URL = (SANDBOX_HOST.startsWith("http") ? SANDBOX_HOST : `https://${SANDBOX_HOST}`).replace(/\/$/, "");
const SANDBOX_SECRET = process.env.SANDBOX_SHARED_SECRET;

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
}

interface FileReadResult {
  content: string;
  exists: boolean;
  errorCode?: "not_found" | "too_large" | "read_failed";
  errorMessage?: string;
}

interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function sandboxRequest<T>(
  path: string,
  sessionId: string,
  body: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<T> {
  const headers: Record<string, string> = {
    "X-Session-Id": sessionId,
    "Content-Type": "application/json",
  };
  if (SANDBOX_SECRET) {
    headers["Authorization"] = `Bearer ${SANDBOX_SECRET}`;
  }

  let res: Response;
  try {
    res = await fetch(`${SANDBOX_URL}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(
      `Sandbox unreachable: ${err instanceof Error ? err.message : "network error"}`,
      { cause: err },
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown error");
    const truncated = text.startsWith("<!") || text.length > 200
      ? `${res.statusText || "error"} (HTML/non-JSON response)`
      : text;
    throw new Error(`Sandbox request failed (${res.status}): ${truncated}`);
  }

  return res.json() as Promise<T>;
}

function sandboxExec(sessionId: string, command: string): Promise<ExecResult> {
  return sandboxRequest<ExecResult>("/exec", sessionId, { command });
}

function sandboxReadFile(sessionId: string, filePath: string): Promise<FileReadResult> {
  return sandboxRequest<FileReadResult>("/read", sessionId, { path: filePath });
}

function sandboxGit(sessionId: string, args: string[]): Promise<GitResult> {
  return sandboxRequest<GitResult>("/git", sessionId, { args });
}

export interface DirectoryEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  extension?: string;
  size?: number;
  gitStatus?: string;
}

export interface DirectoryListResult {
  path: string;
  entries: DirectoryEntry[];
}

export interface FileContentResult {
  path: string;
  content: string;
  language: string;
  size: number;
  truncated: boolean;
  binary?: boolean;
}

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  changes: GitChangeEntry[];
  clean: boolean;
}

export interface GitChangeEntry {
  path: string;
  status: string;
  linesAdded: number;
  linesRemoved: number;
}

export interface GitDiffResult {
  path: string;
  diff: string;
  binary: boolean;
  tooLarge: boolean;
}

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1) : "";
}

function isBinaryExtension(ext: string): boolean {
  const binaryExts = new Set([
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "svg",
    "woff", "woff2", "ttf", "otf", "eot",
    "zip", "tar", "gz", "bz2", "7z", "rar",
    "pdf", "doc", "docx", "xls", "xlsx",
    "exe", "dll", "so", "dylib", "o", "a",
    "mp3", "mp4", "avi", "mov", "wav", "flac",
    "sqlite", "db",
  ]);
  return binaryExts.has(ext.toLowerCase());
}

export async function listDirectory(
  sessionId: string,
  dirPath: string,
): Promise<DirectoryListResult> {
  const normalizedDir = dirPath === "/" ? "." : dirPath.replace(/^\//, "");

  const result = await sandboxExec(
    sessionId,
    `find "${normalizedDir}" -maxdepth 1 -not -path "${normalizedDir}" -printf "%y %s %f\\n" 2>/dev/null | head -500`,
  );

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    return { path: dirPath, entries: [] };
  }

  const gitStatusMap = await getGitStatusMap(sessionId);
  const entries: DirectoryEntry[] = [];

  for (const line of result.stdout.trim().split("\n")) {
    if (!line.trim()) continue;
    const [type, sizeStr, ...nameParts] = line.split(" ");
    const name = nameParts.join(" ");
    if (!name || name === "." || name === "..") continue;

    const entryPath = dirPath === "/" ? `/${name}` : `${dirPath}/${name}`;
    const ext = getFileExtension(name);

    entries.push({
      name,
      path: entryPath,
      type: type === "d" ? "directory" : "file",
      extension: ext || undefined,
      size: type === "f" ? parseInt(sizeStr, 10) || undefined : undefined,
      gitStatus: gitStatusMap.get(entryPath.replace(/^\//, "")) ?? undefined,
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { path: dirPath, entries };
}

export async function readFileContent(
  sessionId: string,
  filePath: string,
): Promise<FileContentResult> {
  const normalizedPath = filePath.replace(/^\//, "");
  const ext = getFileExtension(normalizedPath.split("/").pop() ?? "");

  if (isBinaryExtension(ext)) {
    return {
      path: filePath,
      content: "",
      language: ext,
      size: 0,
      truncated: false,
      binary: true,
    };
  }

  const result = await sandboxReadFile(sessionId, normalizedPath);

  if (!result.exists) {
    throw new Error(result.errorCode === "too_large" ? "File too large" : "File not found");
  }

  const content = result.content;
  const maxBytes = 500 * 1024;
  const truncated = content.length > maxBytes;

  return {
    path: filePath,
    content: truncated ? content.slice(0, maxBytes) : content,
    language: ext || "text",
    size: content.length,
    truncated,
  };
}

export async function getGitStatus(sessionId: string): Promise<GitStatusResult> {
  const branchResult = await sandboxGit(sessionId, ["branch", "--show-current"]);
  const branch = branchResult.stdout.trim() || "main";

  const statusResult = await sandboxGit(sessionId, ["status", "--porcelain=v1"]);

  if (statusResult.exitCode !== 0) {
    return { branch, ahead: 0, behind: 0, changes: [], clean: true };
  }

  const changes: GitChangeEntry[] = [];
  for (const line of statusResult.stdout.split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2).trim();
    const path = line.slice(3).trim();
    if (!path) continue;

    const numstat = await sandboxGit(sessionId, ["diff", "--numstat", "--", path]);
    let linesAdded = 0;
    let linesRemoved = 0;
    const statLine = numstat.stdout.trim().split("\n")[0];
    if (statLine) {
      const [added, removed] = statLine.split("\t");
      linesAdded = parseInt(added, 10) || 0;
      linesRemoved = parseInt(removed, 10) || 0;
    }

    changes.push({ path, status, linesAdded, linesRemoved });
  }

  return {
    branch,
    ahead: 0,
    behind: 0,
    changes,
    clean: changes.length === 0,
  };
}

export async function getFileDiff(
  sessionId: string,
  filePath: string,
): Promise<GitDiffResult> {
  const normalizedPath = filePath.replace(/^\//, "");

  const result = await sandboxGit(sessionId, ["diff", "--", normalizedPath]);

  if (result.exitCode !== 0 && !result.stdout.trim()) {
    const stagedResult = await sandboxGit(sessionId, ["diff", "--cached", "--", normalizedPath]);
    if (stagedResult.stdout.trim()) {
      return {
        path: filePath,
        diff: stagedResult.stdout,
        binary: false,
        tooLarge: stagedResult.stdout.split("\n").length > 1000,
      };
    }

    const untrackedResult = await sandboxGit(sessionId, [
      "diff", "--no-index", "/dev/null", normalizedPath,
    ]);
    return {
      path: filePath,
      diff: untrackedResult.stdout,
      binary: false,
      tooLarge: untrackedResult.stdout.split("\n").length > 1000,
    };
  }

  const isBinary = result.stdout.includes("Binary files") && result.stdout.includes("differ");

  return {
    path: filePath,
    diff: isBinary ? "" : result.stdout,
    binary: isBinary,
    tooLarge: !isBinary && result.stdout.split("\n").length > 1000,
  };
}

async function getGitStatusMap(sessionId: string): Promise<Map<string, string>> {
  const result = await sandboxGit(sessionId, ["status", "--porcelain=v1"]);
  const map = new Map<string, string>();

  if (result.exitCode !== 0) return map;

  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2).trim();
    const path = line.slice(3).trim();
    if (path) map.set(path, status);
  }

  return map;
}

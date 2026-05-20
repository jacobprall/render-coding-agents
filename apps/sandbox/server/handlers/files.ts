import { existsSync, mkdirSync, realpathSync } from "node:fs";
import type { GrepResult } from "../../types";
import { DEFAULT_EXEC_TIMEOUT_MS, MAX_GLOB_RESULTS, MAX_READ_BYTES, MAX_WRITE_BYTES } from "../lib/constants";
import { jsonError } from "../lib/http-response";
import { childProcessEnv, killProcTree } from "../lib/process";
import {
  assertRealPathWithinSessionWorkspace,
  getSessionWorkspace,
  getSessionId,
  validatePath,
} from "../lib/path-security";

export async function handleRead(req: Request, body: Record<string, unknown>): Promise<Response> {
  const sessionId = getSessionId(req);
  const pathRaw = typeof body.path === "string" ? body.path : "";

  let filePath: string;
  try {
    filePath = validatePath(sessionId, pathRaw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("traversal") || msg.includes("symlink") ? "PATH_TRAVERSAL" : "READ_FAILED";
    return jsonError(req, 400, code, msg);
  }

  if (!existsSync(filePath)) {
    return Response.json({ content: "", exists: false, errorCode: "not_found" });
  }

  try {
    const realFinal = realpathSync(filePath);
    assertRealPathWithinSessionWorkspace(realFinal, sessionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(req, 400, "PATH_TRAVERSAL", msg);
  }

  const file = Bun.file(filePath);
  const size = file.size;
  if (size > MAX_READ_BYTES) {
    return Response.json({
      content: "",
      exists: false,
      errorCode: "too_large",
      errorMessage: `File is larger than ${MAX_READ_BYTES} bytes`,
    });
  }

  try {
    const content = await file.text();
    return Response.json({ content, exists: true });
  } catch (err) {
    return Response.json({
      content: "",
      exists: false,
      errorCode: "read_failed",
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function handleWrite(req: Request, body: Record<string, unknown>): Promise<Response> {
  const sessionId = getSessionId(req);
  const pathRaw = typeof body.path === "string" ? body.path : "";
  const content = typeof body.content === "string" ? body.content : null;

  if (content === null) {
    return jsonError(req, 400, "VALIDATION_ERROR", "content must be a string");
  }

  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
    return jsonError(req, 400, "CONTENT_TOO_LARGE", `Content exceeds ${MAX_WRITE_BYTES} bytes`);
  }

  let filePath: string;
  try {
    filePath = validatePath(sessionId, pathRaw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("traversal") || msg.includes("symlink") ? "PATH_TRAVERSAL" : "WRITE_FAILED";
    return jsonError(req, 400, code, msg);
  }

  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });

  try {
    await Bun.write(filePath, content);
  } catch (e) {
    return jsonError(req, 500, "WRITE_FAILED", e instanceof Error ? e.message : String(e));
  }

  try {
    const realFinal = realpathSync(filePath);
    assertRealPathWithinSessionWorkspace(realFinal, sessionId);
  } catch {
    await Bun.file(filePath).delete().catch(() => {});
    return jsonError(req, 400, "PATH_TRAVERSAL", "Path escapes session workspace (symlink)");
  }

  return Response.json({ ok: true });
}

export async function handleGlob(req: Request, body: Record<string, unknown>): Promise<Response> {
  const sessionId = getSessionId(req);
  const pattern = typeof body.pattern === "string" ? body.pattern : "";

  if (!pattern) {
    return jsonError(req, 400, "VALIDATION_ERROR", "pattern is required");
  }

  const cwd = getSessionWorkspace(sessionId);
  if (!existsSync(cwd)) {
    return Response.json({ files: [], truncated: false });
  }

  const glob = new Bun.Glob(pattern);
  const files: string[] = [];

  for await (const file of glob.scan({ cwd, onlyFiles: true })) {
    files.push(file);
    if (files.length >= MAX_GLOB_RESULTS) break;
  }

  return Response.json({ files, truncated: files.length >= MAX_GLOB_RESULTS });
}

export async function handleGrep(req: Request, body: Record<string, unknown>): Promise<Response> {
  const sessionId = getSessionId(req);
  const pattern = typeof body.pattern === "string" ? body.pattern : "";
  const searchPath =
    typeof body.path === "string" && body.path.length > 0 ? (body.path as string) : undefined;

  if (!pattern) {
    return jsonError(req, 400, "VALIDATION_ERROR", "pattern is required");
  }

  let cwd: string;
  try {
    cwd = searchPath ? validatePath(sessionId, searchPath) : getSessionWorkspace(sessionId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(req, 400, "PATH_TRAVERSAL", msg);
  }

  if (!existsSync(cwd)) {
    return Response.json({ matches: [] });
  }

  const proc = Bun.spawn(["rg", "--json", "--", pattern, "."], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: childProcessEnv(),
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcTree(proc);
  }, DEFAULT_EXEC_TIMEOUT_MS);

  const [stdout] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  clearTimeout(timer);

  const matches: GrepResult["matches"] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as {
        type: string;
        data?: { path?: { text: string }; line_number?: number; lines?: { text: string } };
      };
      if (entry.type === "match" && entry.data) {
        matches.push({
          file: entry.data.path?.text ?? "",
          line: entry.data.line_number ?? 0,
          content: entry.data.lines?.text ?? "",
        });
      }
    } catch {
      // skip malformed lines
    }
  }

  if (timedOut) {
    return jsonError(req, 504, "GREP_TIMEOUT", "grep timed out");
  }

  return Response.json({ matches });
}

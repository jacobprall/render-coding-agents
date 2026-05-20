import type { GitResult } from "../../types";
import { DEFAULT_GIT_USER_EMAIL, DEFAULT_GIT_USER_NAME } from "../lib/constants";
import { jsonError } from "../lib/http-response";
import { validateGitArgv } from "../lib/git-policy";
import { getSessionWorkspace, getSessionId } from "../lib/path-security";
import { runArgv } from "../lib/process";

export async function handleGit(req: Request, body: Record<string, unknown>): Promise<Response> {
  const sessionId = getSessionId(req);
  const rawArgs = body.args;
  const safeArgs =
    Array.isArray(rawArgs) ? rawArgs.filter((a): a is string => typeof a === "string") : [];

  const policyErr = validateGitArgv(safeArgs);
  if (policyErr) {
    return jsonError(req, 400, "GIT_POLICY", policyErr);
  }

  const cwd = getSessionWorkspace(sessionId);

  const gitIdentityEnv = {
    GIT_AUTHOR_NAME: DEFAULT_GIT_USER_NAME,
    GIT_AUTHOR_EMAIL: DEFAULT_GIT_USER_EMAIL,
    GIT_COMMITTER_NAME: DEFAULT_GIT_USER_NAME,
    GIT_COMMITTER_EMAIL: DEFAULT_GIT_USER_EMAIL,
  };

  const result = await runArgv(["git", ...safeArgs], cwd, 60_000, gitIdentityEnv);
  const gitResult: GitResult = { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };

  return Response.json(gitResult);
}

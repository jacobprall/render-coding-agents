export const PORT = Number(process.env.PORT ?? 3001);

export const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? "/workspace";
export const SNAPSHOT_DIR = process.env.SESSION_SNAPSHOT_DIR ?? "/workspace/snapshots";

export const DEFAULT_EXEC_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_VERIFY_TIMEOUT_MS = 2 * 60 * 1000;

export const SANDBOX_SHARED_SECRET = process.env.SANDBOX_SHARED_SECRET;
export const SANDBOX_SESSION_SECRET = process.env.SANDBOX_SESSION_SECRET;

export const DEFAULT_GIT_USER_NAME = process.env.SANDBOX_GIT_USER_NAME ?? "Forge Agent";
export const DEFAULT_GIT_USER_EMAIL =
  process.env.SANDBOX_GIT_USER_EMAIL ?? "agent@coding-agents.dev";

export const MAX_READ_BYTES = 5 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = MAX_READ_BYTES;
export const MAX_WRITE_BYTES = MAX_READ_BYTES;
export const MAX_GLOB_RESULTS = 10_000;
export const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

/** Identifiers embedded in URLs, paths, filesystem */
export const SAFE_SANDBOX_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export const IS_PRODUCTION = process.env.NODE_ENV === "production";

export const ALLOWED_ENV_KEYS = new Set([
  "HOME",
  "USER",
  "PATH",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TEMP",
  "NODE_ENV",
  "NODE_PATH",
  "BUN_INSTALL",
  "WORKSPACE_ROOT",
  "SESSION_SNAPSHOT_DIR",
  "PORT",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
]);

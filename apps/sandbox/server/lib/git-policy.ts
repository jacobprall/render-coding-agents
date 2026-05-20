/** Git arguments allowed via HTTP `/git` endpoint */
export const GIT_ALLOWED_SUBCOMMANDS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "checkout",
  "add",
  "commit",
  "push",
  "pull",
  "fetch",
  "clone",
  "merge",
  "rebase",
  "reset",
  "stash",
  "tag",
  "remote",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "cat-file",
  "init",
  "clean",
  "config",
  "restore",
  "switch",
  "blame",
  "describe",
]);

/** Forbidden only as global Git options appearing *before* the subcommand */
const FORBIDDEN_GIT_GLOBALS = new Set([
  "-c",
  "--config-env",
  "--exec-path",
  "--upload-pack",
  "--receive-pack",
]);

function normalizeFlagToken(flag: string): string {
  return flag.split("=")[0] ?? flag;
}

/**
 * Returns an error message if argv is not safe, or null if OK.
 */
export function validateGitArgv(args: string[]): string | null {
  if (args.length === 0) {
    return "git requires at least one argument";
  }

  let i = 0;
  while (i < args.length) {
    const a = args[i]!;
    if (a === "--") {
      i++;
      break;
    }
    if (a.startsWith("-")) {
      if (FORBIDDEN_GIT_GLOBALS.has(normalizeFlagToken(a))) {
        return `Forbidden global git flag: ${a}`;
      }
      i++;
      continue;
    }
    break;
  }

  const sub = args[i];
  if (!sub || sub.startsWith("-")) {
    return "Missing git subcommand (options must precede subcommand)";
  }

  if (!GIT_ALLOWED_SUBCOMMANDS.has(sub)) {
    return `Git subcommand not allowed: ${sub}`;
  }

  return null;
}

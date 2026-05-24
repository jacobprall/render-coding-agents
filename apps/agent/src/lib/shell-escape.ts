/**
 * Escape a string for safe inclusion in a POSIX shell command.
 * Uses single-quote wrapping with escaped embedded quotes.
 *
 * @throws Error if input contains null bytes
 * @returns POSIX-safe single-quoted shell literal
 */
export function shellEscape(s: string): string {
  if (s.includes("\0")) {
    throw new Error("Null byte in shell argument");
  }
  if (s === "") return "''";
  return `'${s.replace(/'/g, "'\\''")}'`;
}

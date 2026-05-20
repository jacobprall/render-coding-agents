import type { CredentialPermissions } from "./types";

// ---------------------------------------------------------------------------
// CredentialRedactor — regex-based secret redaction
// ---------------------------------------------------------------------------

const REDACTION_PLACEHOLDER = "[REDACTED]";

/**
 * Scan `text` for patterns defined in the policy and replace each match
 * with `[REDACTED]`. Returns the sanitised string.
 */
export function redactCredentials(
  text: string,
  policy: CredentialPermissions,
): string {
  if (!text || policy.patterns.length === 0) return text;

  let result = text;
  for (const pattern of policy.patterns) {
    try {
      const re = new RegExp(pattern, "g");
      result = result.replace(re, REDACTION_PLACEHOLDER);
    } catch {
      // Invalid regex — skip rather than crash
    }
  }
  return result;
}

/**
 * Returns true if `text` contains any credential pattern match.
 * Useful for pre-flight checks before storing content.
 */
export function containsCredentials(
  text: string,
  policy: CredentialPermissions,
): boolean {
  if (!text || policy.patterns.length === 0) return false;

  for (const pattern of policy.patterns) {
    try {
      if (new RegExp(pattern).test(text)) return true;
    } catch {
      // skip invalid regex
    }
  }
  return false;
}

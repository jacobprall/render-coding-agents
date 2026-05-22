/**
 * Redact __SECRET__-prefixed env values from text before it enters LLM context.
 *
 * Apply via `formatToolOutputForLlm` in the agent loop (loop.ts) so exec, grep,
 * read_file, and other tool results are redacted before the model sees them.
 * Also apply when serving compacted results from get_tool_result.
 */
export function redactSecrets(
  text: string,
  secrets: Record<string, string>,
): string {
  if (!text || Object.keys(secrets).length === 0) return text;

  let result = text;
  for (const [key, value] of Object.entries(secrets)) {
    if (!key.startsWith("__SECRET__") || !value) continue;
    result = result.replaceAll(value, `[REDACTED:${key.replace("__SECRET__", "")}]`);
  }
  return result;
}

export function formatToolOutputForLlm(
  output: unknown,
  secrets?: Record<string, string>,
): string {
  const serialized = typeof output === "string" ? output : JSON.stringify(output);
  if (!secrets || Object.keys(secrets).length === 0) return serialized;
  return redactSecrets(serialized, secrets);
}

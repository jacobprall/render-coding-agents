/**
 * Byte-safe string truncation (UTF-8 aware).
 */
export function truncateByBytes(input: string, maxBytes: number, suffix = "...[TRUNCATED]"): string {
  const encoded = new TextEncoder().encode(input);
  if (encoded.byteLength <= maxBytes) return input;
  const reserved = new TextEncoder().encode(suffix).byteLength;
  const truncated = encoded.slice(0, Math.max(0, maxBytes - reserved));
  const decoded = new TextDecoder().decode(truncated);
  return `${decoded}${suffix}`;
}

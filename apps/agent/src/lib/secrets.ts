/** Keys that likely hold credentials in metadata objects. */
export function looksSecretKey(key: string): boolean {
  return /(?:^|_)(key|secret|token|password)$/i.test(key);
}

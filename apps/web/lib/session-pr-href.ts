/**
 * Canonical href for a session-linked pull request on GitHub.
 */
export function agentSessionPullHref(args: {
  repoPath: string | null | undefined;
  prNumber: number | null | undefined;
  upstreamPrUrl?: string | null;
}): string {
  if (args.prNumber == null) return "#";
  const upstream = args.upstreamPrUrl?.trim();
  if (upstream) return upstream;
  const rp = args.repoPath?.trim();
  if (!rp) return "#";
  return `https://github.com/${rp}/pull/${args.prNumber}`;
}

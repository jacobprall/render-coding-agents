export function repoSlug(repoPath: string | null): string {
  if (!repoPath) return "Scratch";
  const parts = repoPath.split("/");
  return parts[parts.length - 1] || repoPath;
}

export function formatRelativeTime(input: string | null | undefined): string {
  if (!input) return "";
  const ts = new Date(input).getTime();
  if (Number.isNaN(ts)) return "";
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export const STATUS_DOT: Record<string, string> = {
  running: "bg-teal-500 animate-pulse",
  completed: "bg-primary",
  failed: "bg-destructive",
  idle: "bg-muted-foreground",
  paused: "bg-yellow-500",
  archived: "bg-muted-foreground",
};

import Link from "next/link";

export default function RepoNotFound() {
  return (
    <div className="mx-auto max-w-lg border border-stroke-subtle bg-surface-1 px-6 py-10 text-center">
      <h2 className="text-lg font-semibold text-text-primary">Repository not found</h2>
      <p className="mt-2 text-sm text-text-tertiary">
        We could not load this repository. It may have been renamed, removed, or you may not have access.
      </p>
      <Link
        href="/sessions"
        className="mt-6 inline-block bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
      >
        Back to sessions
      </Link>
    </div>
  );
}

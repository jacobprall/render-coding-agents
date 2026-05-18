"use client";

import Link from "next/link";

export default function RepoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg border border-stroke-subtle bg-surface-1 px-6 py-10 text-center">
      <h2 className="text-lg font-semibold text-text-primary">Something went wrong</h2>
      <p className="mt-2 text-sm text-text-tertiary">{error.message || "This repository page failed to load."}</p>
      <div className="mt-6 flex justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="border border-stroke-default px-4 py-2 text-sm font-medium text-text-primary hover:bg-surface-2"
        >
          Try again
        </button>
        <Link
          href="/sessions"
          className="bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
        >
          Back to sessions
        </Link>
      </div>
    </div>
  );
}

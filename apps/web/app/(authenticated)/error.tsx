"use client";

import Link from "next/link";

export default function AuthenticatedError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-danger/10">
        <svg
          className="h-6 w-6 text-danger"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
          />
        </svg>
      </div>
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="mt-2 text-sm text-text-tertiary">
        {error.message || "An unexpected error occurred."}
      </p>
      {error.digest && (
        <p className="mt-1 font-mono text-xs text-text-tertiary">
          Error ID: {error.digest}
        </p>
      )}
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          onClick={reset}
          className="bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-(--of-duration-instant) hover:bg-accent-hover"
        >
          Try again
        </button>
        <Link
          href="/sessions"
          className="border border-stroke-default px-4 py-2 text-sm font-medium text-text-secondary transition-colors duration-(--of-duration-instant) hover:bg-surface-2"
        >
          Go to sessions
        </Link>
      </div>
    </div>
  );
}

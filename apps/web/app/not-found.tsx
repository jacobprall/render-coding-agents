import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="max-w-md text-center">
        <p className="text-6xl font-bold text-text-tertiary">404</p>
        <h2 className="mt-4 text-lg font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-text-tertiary">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block bg-accent px-4 py-2 text-sm font-medium text-white transition-colors duration-(--of-duration-instant) hover:bg-accent/60"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}

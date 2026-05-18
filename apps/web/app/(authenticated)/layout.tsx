import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { DynamicShell } from "@/components/layout/dynamic-shell";
import { ThemeProvider } from "@/components/providers/theme-provider";

function AuthenticatedAppSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex h-12 animate-pulse border-b border-border bg-card" />
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-8 h-8 w-48 animate-pulse bg-muted" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse border border-border bg-card"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

async function AuthenticatedBody({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/");

  return (
    <ThemeProvider>
      <DynamicShell
        user={{
          username: session.username,
          avatarUrl: session.avatarUrl,
        }}
      >
        {children}
      </DynamicShell>
    </ThemeProvider>
  );
}

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<AuthenticatedAppSkeleton />}>
      <AuthenticatedBody>{children}</AuthenticatedBody>
    </Suspense>
  );
}

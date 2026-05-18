"use client";

import { AppShell } from "./app-shell";

interface DynamicShellProps {
  user: { username: string; avatarUrl: string };
  children: React.ReactNode;
}

export function DynamicShell({ user, children }: DynamicShellProps) {
  return (
    <AppShell user={user}>
      {children}
    </AppShell>
  );
}

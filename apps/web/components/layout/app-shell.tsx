"use client";

import { IconRail } from "./icon-rail";
import { SessionTabs } from "./session-tabs";
import { useSessionTabsSync } from "./use-session-tabs-sync";

interface AppShellProps {
  user: {
    username: string;
    avatarUrl: string;
  };
  children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  useSessionTabsSync();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden md:flex">
        <IconRail user={user} />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">
        <SessionTabs />
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

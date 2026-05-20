"use client";

import { useCallback, useEffect, useState } from "react";
import { IconRail } from "./icon-rail";
import { SessionTabs } from "./session-tabs";
import { SessionDrawer } from "./session-drawer";
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
  const [drawerOpen, setDrawerOpen] = useState(false);

  const toggleDrawer = useCallback(() => setDrawerOpen((o) => !o), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        toggleDrawer();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [toggleDrawer]);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden md:flex">
        <IconRail user={user} onSessionsClick={toggleDrawer} />
      </div>
      <SessionDrawer open={drawerOpen} onClose={closeDrawer} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <SessionTabs />
        <main className="relative min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

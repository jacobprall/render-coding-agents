"use client";

import { usePathname, useRouter } from "next/navigation";
import { MessageSquare, FolderOpen, GitBranch, List } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RightPanelMode } from "./right-panel-context";

export type MobileView = "sessions" | "chat" | "files" | "git";

interface MobileBottomNavProps {
  activeView: MobileView;
  onViewChange: (view: MobileView) => void;
  hasSession: boolean;
  changedFilesCount?: number;
}

export function MobileBottomNav({
  activeView,
  onViewChange,
  hasSession,
  changedFilesCount = 0,
}: MobileBottomNavProps) {
  const items: { id: MobileView; icon: typeof MessageSquare; label: string; badge?: number }[] = [
    { id: "sessions", icon: List, label: "Sessions" },
    { id: "chat", icon: MessageSquare, label: "Chat" },
    { id: "files", icon: FolderOpen, label: "Files" },
    { id: "git", icon: GitBranch, label: "Git", badge: changedFilesCount },
  ];

  return (
    <nav
      className="flex shrink-0 items-stretch border-t border-border bg-card"
      style={{ height: "calc(56px + var(--safe-area-bottom))", paddingBottom: "var(--safe-area-bottom)" }}
    >
      {items.map(({ id, icon: Icon, label, badge }) => {
        const isActive = activeView === id;
        const disabled = !hasSession && id !== "sessions" && id !== "chat";

        return (
          <button
            key={id}
            type="button"
            disabled={disabled}
            onClick={() => onViewChange(id)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors",
              isActive
                ? "text-primary"
                : "text-muted-foreground",
              disabled && "opacity-30 pointer-events-none",
            )}
          >
            <span className="relative">
              <Icon className="size-5" strokeWidth={isActive ? 2.2 : 1.8} />
              {badge && badge > 0 ? (
                <span className="absolute -right-1.5 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-white">
                  {badge > 9 ? "9+" : badge}
                </span>
              ) : null}
            </span>
            <span className="font-medium">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}

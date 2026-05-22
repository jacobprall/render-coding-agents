"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, MessageCircle, LogOut, Moon, Sun } from "lucide-react";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface IconRailProps {
  user: {
    username: string;
    avatarUrl: string;
  };
  onSessionsClick?: () => void;
}

export function IconRail({ user, onSessionsClick }: IconRailProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  const sessionsActive =
    pathname === "/sessions" || pathname.startsWith("/sessions/");

  const observabilityActive =
    pathname === "/observability" ||
    pathname.startsWith("/observability/");

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-screen w-12 flex-col items-center border-r border-border bg-card py-3">
        {/* Mode switcher */}
        <nav className="flex flex-1 flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onSessionsClick}
                className={`flex h-9 w-9 items-center justify-center transition-colors ${
                  sessionsActive
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted hover:text-muted-foreground"
                }`}
              >
                <MessageCircle className="h-[18px] w-[18px]" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sessions</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/observability"
                className={`flex h-9 w-9 items-center justify-center transition-colors ${
                  observabilityActive
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted hover:text-muted-foreground"
                }`}
              >
                <Activity className="h-[18px] w-[18px]" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Observability</TooltipContent>
          </Tooltip>
        </nav>

        {/* Bottom actions */}
        <div className="flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="flex h-9 w-9 items-center justify-center text-foreground transition-colors hover:bg-muted hover:text-muted-foreground"
              >
                {theme === "dark" ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Toggle theme</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                className="flex h-9 w-9 items-center justify-center text-foreground transition-colors hover:bg-muted hover:text-muted-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Sign out</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/settings"
                className="mt-1 flex h-8 w-8 items-center justify-center overflow-hidden"
              >
                {user.avatarUrl ? (
                  <img
                    src={user.avatarUrl}
                    alt={user.username}
                    className="h-7 w-7"
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center bg-muted text-xs font-medium text-muted-foreground">
                    {user.username.charAt(0).toUpperCase()}
                  </div>
                )}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{user.username}</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    </TooltipProvider>
  );
}

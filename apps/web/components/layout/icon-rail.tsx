"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, Settings, LogOut, Moon, Sun } from "lucide-react";
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
}

const modes = [
  { id: "sessions", href: "/sessions", icon: MessageCircle, label: "Sessions" },
  { id: "settings", href: "/settings", icon: Settings, label: "Settings" },
] as const;

export function IconRail({ user }: IconRailProps) {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  function isActive(href: string) {
    if (href === "/sessions") {
      return pathname === "/sessions" || pathname.startsWith("/sessions/");
    }
    return pathname.startsWith(href);
  }

  return (
    <TooltipProvider delayDuration={0}>
      <aside className="flex h-screen w-12 flex-col items-center border-r border-border bg-card py-3">
        {/* Logo */}
        <Link href="/sessions" className="mb-4 flex h-8 w-8 items-center justify-center">
          <svg
            className="h-5 w-5 text-primary"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z"
            />
          </svg>
        </Link>

        {/* Mode switcher */}
        <nav className="flex flex-1 flex-col items-center gap-1">
          {modes.map((mode) => {
            const Icon = mode.icon;
            const active = isActive(mode.href);
            return (
              <Tooltip key={mode.id}>
                <TooltipTrigger asChild>
                  <Link
                    href={mode.href}
                    className={`flex h-9 w-9 items-center justify-center transition-colors ${
                      active
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">{mode.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className="flex flex-col items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                className="flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
                className="flex h-9 w-9 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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

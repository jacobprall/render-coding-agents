"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageCircle,
  List,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Code,
  User,
  Key,
} from "lucide-react";
import { signOut } from "next-auth/react";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  children?: { label: string; href: string; icon: React.ComponentType<{ className?: string }>; exact?: boolean }[];
}

const navItems: NavItem[] = [
  { label: "Chat", href: "/sessions/new", icon: MessageCircle },
  { label: "Sessions", href: "/sessions", icon: List, exact: true },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    children: [
      { label: "Profile", href: "/settings", icon: User, exact: true },
      { label: "API Keys", href: "/settings/api-keys", icon: Key },
    ],
  },
];

interface SidebarProps {
  user: {
    username: string;
    avatarUrl: string;
  };
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({ user, mobileOpen, onMobileClose }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  const activeParent = navItems.find(
    (item) =>
      pathname === item.href ||
      pathname.startsWith(item.href + "/") ||
      item.children?.some(
        (c) =>
          c.exact ? pathname === c.href : pathname === c.href || pathname.startsWith(c.href + "/"),
      ),
  );
  const showSubNav = activeParent?.children && !collapsed;

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }

  useEffect(() => {
    onMobileClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function handleSignOut() {
    await signOut({ callbackUrl: "/" });
  }

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <div className="flex">
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex h-screen flex-col border-r border-stroke-subtle bg-surface-1 transition-transform duration-(--of-duration-normal) md:static md:translate-x-0 ${
            mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          } ${collapsed ? "w-16" : "w-56"}`}
        >
          <div
            className={`flex h-14 items-center ${
              collapsed ? "justify-center" : "gap-2 px-(--of-space-md)"
            }`}
          >
            <Code className="h-5 w-5 shrink-0 text-accent" />
            {!collapsed && (
              <span className="truncate text-[14px] font-semibold tracking-tight text-text-primary">
                Coding Agents
              </span>
            )}
          </div>

          <nav className="flex-1 py-(--of-space-sm)">
            {navItems.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + "/");
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={`flex min-h-11 items-center gap-3 px-(--of-space-md) py-3 text-[14px] font-medium transition-colors duration-(--of-duration-instant) border-l-[3px] ${
                    isActive
                      ? "bg-surface-2 text-accent-text border-l-accent"
                      : "text-text-secondary hover:bg-surface-2 hover:text-text-primary border-l-transparent"
                  } ${collapsed ? "justify-center px-0 border-l-0" : ""}`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && <span className="flex-1">{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-stroke-subtle p-(--of-space-sm)">
            <div
              className={`flex items-center gap-3 px-(--of-space-sm) py-2 ${
                collapsed ? "justify-center px-0" : ""
              }`}
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.username}
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 bg-surface-3"
                />
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center bg-surface-3 text-xs font-medium text-text-secondary">
                  {user.username.charAt(0).toUpperCase()}
                </div>
              )}
              {!collapsed && (
                <span className="flex-1 truncate text-sm text-text-secondary">
                  {user.username}
                </span>
              )}
              {!collapsed && (
                <button
                  onClick={handleSignOut}
                  title="Sign out"
                  className="flex min-h-10 min-w-10 items-center justify-center text-text-tertiary transition-colors duration-(--of-duration-instant) hover:bg-surface-2 hover:text-text-secondary"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              )}
            </div>

            {collapsed && (
              <button
                onClick={handleSignOut}
                title="Sign out"
                className="mt-1 flex min-h-11 w-full items-center justify-center text-text-tertiary transition-colors duration-(--of-duration-instant) hover:bg-surface-2 hover:text-text-secondary"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="hidden border-t border-stroke-subtle p-(--of-space-sm) md:block">
            <button
              onClick={toggleCollapsed}
              className="flex w-full items-center justify-center p-2 text-text-tertiary transition-colors duration-(--of-duration-instant) hover:bg-surface-2 hover:text-text-secondary"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </button>
          </div>
        </aside>

        {showSubNav && activeParent.children && (
          <div className="hidden md:flex h-screen w-48 flex-col border-r border-stroke-subtle bg-surface-0 py-(--of-space-md)">
            <div className="px-(--of-space-md) pb-(--of-space-sm)">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
                {activeParent.label}
              </span>
            </div>
            {activeParent.children.map((child) => {
              const isChildActive = child.exact
                ? pathname === child.href
                : pathname === child.href || pathname.startsWith(child.href + "/");
              const ChildIcon = child.icon;
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  className={`flex items-center gap-2 px-(--of-space-md) py-2 text-[13px] font-medium transition-colors duration-(--of-duration-instant) border-l-2 ${
                    isChildActive
                      ? "bg-surface-2 text-text-primary border-l-accent"
                      : "text-text-secondary hover:bg-surface-1 hover:text-text-primary border-l-transparent"
                  }`}
                >
                  <ChildIcon className="h-3.5 w-3.5 shrink-0" />
                  {child.label}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

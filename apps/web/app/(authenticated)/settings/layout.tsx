"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { User, Key } from "lucide-react";

const settingsLinks = [
  { label: "Profile", href: "/settings", icon: User, exact: true },
  { label: "API Keys", href: "/settings/api-keys", icon: Key },
];

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-text-primary">Settings</h1>

      <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-stroke-subtle md:hidden">
        {settingsLinks.map((link) => {
          const isActive = link.exact
            ? pathname === link.href
            : pathname === link.href || pathname.startsWith(link.href + "/");
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex shrink-0 items-center gap-1.5 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? "border-b-2 border-accent text-accent-text"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {link.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}

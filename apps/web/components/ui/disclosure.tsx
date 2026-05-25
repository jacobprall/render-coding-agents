"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DisclosureProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Disclosure({
  title,
  defaultOpen = false,
  children,
  className,
}: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("border border-border bg-card", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between px-6 py-4 text-left text-lg font-semibold text-foreground transition-colors hover:bg-muted"
      >
        {title}
        <ChevronDown
          className={cn(
            "h-5 w-5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border px-6 pb-6 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}

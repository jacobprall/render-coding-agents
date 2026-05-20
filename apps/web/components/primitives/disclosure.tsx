"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

export interface DisclosureProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function Disclosure({ title, defaultOpen = false, children }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-stroke-subtle bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between px-6 py-4 text-left text-lg font-semibold text-text-primary transition-colors hover:bg-surface-2"
      >
        {title}
        <ChevronDown
          className={`h-5 w-5 text-text-tertiary transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-stroke-subtle px-6 pb-6 pt-4">
          {children}
        </div>
      )}
    </div>
  );
}

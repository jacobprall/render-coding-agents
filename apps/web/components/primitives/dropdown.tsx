"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}

export function Dropdown({
  trigger,
  children,
  align = "left",
  className,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      containerRef.current &&
      !containerRef.current.contains(e.target as Node)
    ) {
      setOpen(false);
    }
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [open, handleClickOutside, handleKeyDown]);

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <div onClick={() => setOpen((prev) => !prev)} className="cursor-pointer">{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute z-50 mt-1 min-w-[180px] border border-stroke-subtle bg-surface-1 p-1 shadow-xl",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          <DropdownContext.Provider value={{ close: () => setOpen(false) }}>
            {children}
          </DropdownContext.Provider>
        </div>
      )}
    </div>
  );
}

const DropdownContext = React.createContext<{ close: () => void }>({
  close: () => {},
});

export interface DropdownItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  destructive?: boolean;
}

export const DropdownItem = React.forwardRef<
  HTMLButtonElement,
  DropdownItemProps
>(({ destructive = false, className, children, onClick, ...props }, ref) => {
  const { close } = React.useContext(DropdownContext);

  return (
    <button
      ref={ref}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors duration-(--of-duration-instant) text-left cursor-pointer",
        destructive
          ? "text-red-400 hover:bg-red-500/10"
          : "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
        className
      )}
      onClick={(e) => {
        onClick?.(e);
        close();
      }}
      {...props}
    >
      {children}
    </button>
  );
});

DropdownItem.displayName = "DropdownItem";

export function DropdownSeparator() {
  return <div className="my-1 h-px bg-stroke-subtle" />;
}

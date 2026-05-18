"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToolStatus = "running" | "success" | "error" | "idle";

interface Props {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  status?: ToolStatus;
  defaultOpen?: boolean;
  preview?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function ToolLayout({
  icon,
  title,
  subtitle,
  status = "idle",
  defaultOpen = false,
  preview,
  children,
  className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const statusIcon =
    status === "running" ? (
      <Loader2 className="size-3 text-text-tertiary animate-spin" />
    ) : status === "success" ? (
      <CheckCircle2 className="size-3 text-accent-text" />
    ) : status === "error" ? (
      <XCircle className="size-3 text-danger" />
    ) : null;

  return (
    <div
      className={cn(
        "border border-stroke-subtle bg-surface-1 text-xs overflow-hidden",
        open ? "flex flex-col w-full min-w-0" : "inline-flex flex-col max-w-[33%] min-w-0 self-start",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-2 px-(--of-space-md) py-(--of-space-sm) text-left hover:bg-surface-2 transition-colors duration-(--of-duration-instant)"
      >
        {open ? (
          <ChevronDown className="size-3 text-text-tertiary shrink-0" />
        ) : (
          <ChevronRight className="size-3 text-text-tertiary shrink-0" />
        )}
        {icon && <span className="shrink-0 text-text-tertiary">{icon}</span>}
        <span className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
          <span
            className={cn(
              "min-w-0 truncate font-medium text-text-primary",
              subtitle ? "max-w-[45%] shrink" : "flex-1",
            )}
          >
            {title}
          </span>
          {subtitle && (
            <span className="min-w-0 flex-1 truncate font-normal text-text-tertiary">
              {subtitle}
            </span>
          )}
        </span>
        {statusIcon && <span className="shrink-0">{statusIcon}</span>}
      </button>
      {!open && preview && (
        <div className="min-w-0 border-t border-stroke-subtle bg-surface-0 px-(--of-space-md) py-(--of-space-xs) font-mono text-foreground/70 overflow-x-auto overflow-y-hidden">
          {preview}
        </div>
      )}
      <div
        className="grid transition-[grid-template-rows] duration-(--of-duration-fast)"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {children && (
            <div className="border-t border-stroke-subtle bg-surface-0 px-(--of-space-md) py-(--of-space-sm) font-mono text-foreground overflow-auto max-h-128">
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

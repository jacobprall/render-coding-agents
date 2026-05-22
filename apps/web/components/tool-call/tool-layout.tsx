"use client";

import { useState } from "react";
import { ChevronDown, CheckCircle2, XCircle, Loader2 } from "lucide-react";
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
  children,
  className,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  const statusIcon =
    status === "running" ? (
      <Loader2 className="size-3 text-muted-foreground animate-spin" />
    ) : status === "success" ? (
      <CheckCircle2 className="size-3 text-accent-text" />
    ) : status === "error" ? (
      <XCircle className="size-3 text-danger" />
    ) : null;

  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-md border border-stroke-subtle bg-muted/30 text-xs",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left transition-colors duration-(--of-duration-instant) hover:bg-muted/50"
      >
        {icon ? <span className="shrink-0 text-text-tertiary">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate text-text-primary">
          <span className="font-medium">{title}</span>
          {subtitle ? <span className="text-text-tertiary"> {subtitle}</span> : null}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {statusIcon}
          <ChevronDown
            className={cn(
              "size-3.5 text-text-tertiary transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-(--of-duration-fast)"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {children ? (
            <div className="border-t border-stroke-subtle bg-card px-3 py-2 font-mono text-foreground overflow-auto max-h-128">
              {children}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

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

function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3 animate-spin text-muted-foreground" />;
    case "success":
      return <CheckCircle2 className="size-3 text-accent-text" />;
    case "error":
      return <XCircle className="size-3 text-danger" />;
    default:
      return null;
  }
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

  return (
    <div
      className={cn(
        "self-start min-w-0 overflow-hidden rounded-md border border-stroke-subtle bg-muted/30 text-xs transition-[max-width,width] duration-(--of-duration-fast)",
        open ? "w-full max-w-full" : "w-fit max-w-[50%]",
        !open && status === "success" && "border-l-2 border-l-accent-text/60",
        !open && status === "error" && "border-l-2 border-l-danger/70",
        !open && status === "running" && "border-l-2 border-l-warning/70",
        className,
      )}
    >
      <div className="flex w-full min-w-0 items-center gap-2 px-3 py-2">
        {!open && icon ? <span className="shrink-0 text-text-tertiary">{icon}</span> : null}
        <span className="min-w-0 flex-1 truncate text-text-primary">
          <span className="font-medium">{title}</span>
          {subtitle ? <span className="text-text-tertiary"> {subtitle}</span> : null}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Collapse tool details" : "Expand tool details"}
          className="ml-auto flex shrink-0 items-center justify-center rounded p-0.5 text-text-tertiary transition-colors hover:bg-muted/50 hover:text-text-primary"
        >
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-(--of-duration-fast)"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          {open && children ? (
            <>
              <div className="flex items-center gap-1.5 border-t border-stroke-subtle bg-muted/20 px-3 py-1.5">
                {icon ? <span className="shrink-0 text-text-tertiary">{icon}</span> : null}
                <StatusIcon status={status} />
              </div>
              <div className="border-t border-stroke-subtle bg-card px-3 py-2 font-mono text-foreground overflow-auto max-h-128">
                {children}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

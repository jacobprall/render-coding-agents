"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, MoreVertical } from "lucide-react";

interface MobileHeaderProps {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  status?: "idle" | "streaming" | "done" | "error";
}

export function MobileHeader({
  title = "New Chat",
  subtitle,
  showBack = false,
  onBack,
  status,
}: MobileHeaderProps) {
  const router = useRouter();

  function handleBack() {
    if (onBack) {
      onBack();
    } else {
      router.push("/sessions");
    }
  }

  return (
    <header
      className="flex shrink-0 items-center gap-1 border-b border-border bg-card px-2"
      style={{
        minHeight: "calc(48px + var(--safe-area-top, 0px))",
        paddingTop: "var(--safe-area-top, 0px)",
      }}
    >
      {showBack ? (
        <button
          type="button"
          onClick={handleBack}
          className="flex h-11 w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground active:bg-surface-1"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col px-1">
        <h1 className="truncate text-sm font-semibold text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      {status === "streaming" ? (
        <span className="inline-flex shrink-0 items-center gap-1 px-2 text-[11px] text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-[orb-float_1.4s_ease-in-out_infinite]" />
          Working
        </span>
      ) : null}
    </header>
  );
}

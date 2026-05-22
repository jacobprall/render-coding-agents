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
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
      {showBack ? (
        <button
          type="button"
          onClick={handleBack}
          className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-sm font-semibold text-foreground">
          {title}
        </h1>
        {subtitle ? (
          <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>

      {status === "streaming" ? (
        <span className="inline-flex items-center gap-1 text-[11px] text-primary">
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-[orb-float_1.4s_ease-in-out_infinite]" />
          Working
        </span>
      ) : null}
    </header>
  );
}

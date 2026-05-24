"use client";

import { Activity, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HomePanelMode } from "@/hooks/use-layout-state";
import { ObservabilityMini } from "./observability-mini";
import { AutomationsMini } from "./automations-mini";

interface HomePanelProps {
  mode: HomePanelMode;
  width: number;
  onModeChange: (mode: HomePanelMode) => void;
  onClose: () => void;
}

export function HomePanel({ mode, width, onModeChange, onClose }: HomePanelProps) {
  return (
    <aside
      aria-label="Home tools panel"
      className="flex h-full min-w-0 flex-col overflow-hidden border-l border-border bg-card"
      style={{ width }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-stroke-subtle px-2 py-1.5">
        <div className="flex items-center gap-0.5">
          <PanelTabButton
            active={mode === "observability"}
            onClick={() => onModeChange("observability")}
            title="Observability"
            ariaLabel="Switch to observability"
          >
            <Activity className="size-3.5" />
          </PanelTabButton>
          <PanelTabButton
            active={mode === "automations"}
            onClick={() => onModeChange("automations")}
            title="Automations"
            ariaLabel="Switch to automations"
          >
            <Zap className="size-3.5" />
          </PanelTabButton>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-primary"
          title="Close panel"
        >
          <X className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "observability" ? <ObservabilityMini /> : <AutomationsMini />}
      </div>
    </aside>
  );
}

function PanelTabButton({
  active,
  onClick,
  title,
  ariaLabel,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={cn(
        "rounded p-1.5 transition-colors",
        active
          ? "bg-surface-2 text-text-primary"
          : "text-text-tertiary hover:bg-surface-2/50 hover:text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}

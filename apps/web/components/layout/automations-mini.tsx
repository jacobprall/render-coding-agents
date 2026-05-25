"use client";

import Link from "next/link";
import { ArrowRight, Zap } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

export function AutomationsMini() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col justify-center p-3">
        <EmptyState
          icon={<Zap className="h-5 w-5" />}
          title="No automations yet"
          description="Configure triggers to spawn agents automatically from schedules, webhooks, or integrations."
        />
      </div>

      <div className="shrink-0 border-t border-border p-2">
        <Link
          href="/automations"
          className="flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-primary transition-colors hover:text-primary/80"
        >
          View all
          <ArrowRight className="size-3" />
        </Link>
      </div>
    </div>
  );
}

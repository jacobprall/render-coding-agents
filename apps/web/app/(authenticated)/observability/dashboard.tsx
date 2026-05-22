"use client";

import { Suspense, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EventsTable } from "./events-table";
import { FilterBar } from "./filter-bar";
import { UsageSummary } from "./usage-summary";
import { useEvents } from "./use-events";

type TabValue = "events" | "usage";

function EventsTab() {
  const { events, total, nextCursor, isLoading, error } = useEvents();
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleLoadMore = useCallback(() => {
    if (!nextCursor) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("cursor", nextCursor);
    router.push(`/observability?${params.toString()}`);
  }, [nextCursor, searchParams, router]);

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-destructive">
        Failed to load events. Please try again.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FilterBar />
      <EventsTable
        events={events}
        isLoading={isLoading}
        total={total}
        nextCursor={nextCursor}
        onLoadMore={handleLoadMore}
      />
    </div>
  );
}

export function ObservabilityDashboard() {
  const [activeTab, setActiveTab] = useState<TabValue>("events");

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Observability</h1>
        <div className="flex gap-1 border border-border p-0.5">
          <button
            onClick={() => setActiveTab("events")}
            className={`px-3 py-1 text-sm font-medium transition-colors ${
              activeTab === "events"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Events
          </button>
          <button
            onClick={() => setActiveTab("usage")}
            className={`px-3 py-1 text-sm font-medium transition-colors ${
              activeTab === "usage"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Usage
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <Suspense fallback={<div className="animate-pulse h-64 bg-muted" />}>
          {activeTab === "events" ? <EventsTab /> : <UsageSummary />}
        </Suspense>
      </div>
    </div>
  );
}

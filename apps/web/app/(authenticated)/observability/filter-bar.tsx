"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

const EVENT_TYPES = [
  { value: "llm_request", label: "LLM Request" },
  { value: "tool_call", label: "Tool Call" },
  { value: "sandbox_exec", label: "Sandbox" },
  { value: "error", label: "Error" },
  { value: "system", label: "System" },
] as const;

const EVENT_STATUSES = [
  { value: "running", label: "Running" },
  { value: "success", label: "Success" },
  { value: "error", label: "Error" },
  { value: "timeout", label: "Timeout" },
  { value: "interrupted", label: "Interrupted" },
] as const;

export function FilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentType = searchParams.get("type") ?? "";
  const currentStatus = searchParams.get("status") ?? "";
  const currentSession = searchParams.get("sessionId") ?? "";

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("cursor");
      router.push(`/observability?${params.toString()}`);
    },
    [router, searchParams],
  );

  const clearAll = useCallback(() => {
    router.push("/observability");
  }, [router]);

  const hasFilters = currentType || currentStatus || currentSession;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={currentType}
        onChange={(e) => updateFilter("type", e.target.value)}
        className="h-8 border border-border bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All types</option>
        {EVENT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <select
        value={currentStatus}
        onChange={(e) => updateFilter("status", e.target.value)}
        className="h-8 border border-border bg-card px-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All statuses</option>
        {EVENT_STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Session ID..."
        value={currentSession}
        onChange={(e) => updateFilter("sessionId", e.target.value)}
        className="h-8 w-48 border border-border bg-card px-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {hasFilters && (
        <button
          onClick={clearAll}
          className="h-8 px-3 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

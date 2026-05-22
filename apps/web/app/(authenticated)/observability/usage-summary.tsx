"use client";

import useSWR from "swr";
import { Activity } from "lucide-react";
import { EmptyState } from "@/components/primitives/empty-state";

interface UsageBreakdown {
  key: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  llmRequestCount: number;
}

interface UsageData {
  totals: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
  breakdown: UsageBreakdown[];
}

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Failed: ${r.status}`);
    return r.json() as Promise<UsageData>;
  });

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function UsageSummary() {
  const { data, isLoading, error } = useSWR<UsageData>(
    "/api/observability/usage?groupBy=model",
    fetcher,
    { revalidateOnFocus: false },
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse bg-muted border border-border" />
          ))}
        </div>
        <div className="h-48 animate-pulse bg-muted border border-border" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-destructive">
        Failed to load usage data. Please try again.
      </div>
    );
  }

  if (!data || data.breakdown.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-5 w-5" />}
        title="No usage data"
        description="LLM token usage will appear here once agent sessions make requests."
      />
    );
  }

  const { totals, breakdown } = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Input Tokens</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatTokens(totals.inputTokens)}
          </div>
        </div>
        <div className="border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Output Tokens</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatTokens(totals.outputTokens)}
          </div>
        </div>
        <div className="border border-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground">Estimated Cost</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {formatCost(totals.estimatedCost)}
          </div>
        </div>
      </div>

      <div className="border border-border">
        <div className="border-b border-border bg-muted/50 px-4 py-2">
          <h3 className="text-xs font-medium text-muted-foreground">Breakdown by Model</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Model</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Requests</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Input</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Output</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Cost</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.map((row) => (
              <tr key={row.key} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs">{row.key}</td>
                <td className="px-4 py-2 text-right tabular-nums">{row.llmRequestCount}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatTokens(row.inputTokens)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{formatTokens(row.outputTokens)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{formatCost(row.estimatedCost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

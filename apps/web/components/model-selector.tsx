"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import type { ModelSummary } from "@coding-agents/shared/client";

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  compact?: boolean;
  inline?: boolean;
  dropUp?: boolean;
}

const FALLBACK_MODELS: ModelSummary[] = [
  { id: "anthropic/claude-sonnet-4-5", provider: "anthropic", label: "Claude Sonnet 4.5", description: "Fast and capable" },
  { id: "anthropic/claude-opus-4", provider: "anthropic", label: "Claude Opus 4", description: "Most capable", supportsThinking: true },
  { id: "anthropic/claude-sonnet-4", provider: "anthropic", label: "Claude Sonnet 4", description: "Balanced speed and capability", supportsThinking: true },
  { id: "openai/gpt-4.1", provider: "openai", label: "GPT-4.1", description: "Strong baseline, fast" },
  { id: "openai/o4-mini", provider: "openai", label: "o4-mini", description: "Reasoning — faster than o3", supportsThinking: true },
];

async function modelsFetcher(url: string): Promise<ModelSummary[]> {
  const r = await fetch(url);
  if (!r.ok) {
    throw new Error(`Failed to load models (${r.status})`);
  }
  const data = (await r.json()) as { models?: ModelSummary[] };
  const models = data.models ?? [];
  if (models.length === 0) {
    throw new Error("No models returned");
  }
  return models;
}

export function ModelSelector({ value, onChange, compact, inline, dropUp }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data, error, isLoading } = useSWR("/api/models", modelsFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    errorRetryCount: 2,
  });

  const models = data ?? FALLBACK_MODELS;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selected = models.find((m) => m.id === value);

  if (isLoading) {
    return <div className={inline ? "h-7 w-24 animate-pulse rounded-md bg-surface-2" : "h-8 w-32 animate-pulse bg-surface-2"} />;
  }

  const usingFallback = !data && !!error;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`flex items-center gap-1.5 text-text-secondary transition-colors duration-(--of-duration-instant) hover:text-text-primary ${
          inline
            ? "min-h-7 rounded-md border-0 bg-transparent px-1.5 py-1 text-xs"
            : `min-h-10 gap-2 border bg-surface-1 px-3 py-2 text-sm hover:border-stroke-subtle ${usingFallback ? "border-amber-500/40" : "border-stroke-default"}`
        }`}
        title={usingFallback ? "Using offline model list — gateway unavailable" : undefined}
      >
        <span className="max-w-36 truncate">{selected?.label ?? value}</span>
        <svg className="h-3 w-3 shrink-0 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen ? (
        <div className={`absolute right-0 z-50 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto border border-stroke-default bg-surface-1 shadow-xl ${dropUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
          {usingFallback ? (
            <div className="border-b border-stroke-subtle bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
              Could not load models from server — showing defaults
            </div>
          ) : null}
          {models.map((model) => (
            <button
              key={model.id}
              type="button"
              onClick={() => {
                onChange(model.id);
                setIsOpen(false);
              }}
              className={`flex w-full flex-col px-3 py-2.5 text-left transition-colors duration-(--of-duration-instant) hover:bg-surface-2 ${
                model.id === value ? "bg-surface-2/50" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{model.label}</span>
                {model.id === value ? (
                  <svg className="h-3.5 w-3.5 text-accent-text" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : null}
              </div>
              {!compact && model.description ? (
                <span className="mt-0.5 text-xs text-text-tertiary">{model.description}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

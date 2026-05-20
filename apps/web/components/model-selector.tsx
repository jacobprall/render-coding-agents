"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import type { ModelSummary } from "@coding-agents/shared";

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  compact?: boolean;
  dropUp?: boolean;
}

async function modelsFetcher(url: string): Promise<ModelSummary[]> {
  const r = await fetch(url);
  const data = (await r.json()) as { models?: ModelSummary[] };
  return data.models ?? [];
}

export function ModelSelector({ value, onChange, compact, dropUp }: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: models = [], isLoading } = useSWR("/api/models", modelsFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });

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
    return <div className="h-8 w-32 animate-pulse bg-surface-2" />;
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex min-h-10 items-center gap-2 border border-stroke-default bg-surface-1 px-3 py-2 text-sm text-text-secondary transition-colors duration-(--of-duration-instant) hover:border-stroke-subtle"
      >
        <span className="truncate">{selected?.label ?? value}</span>
        <svg className="h-3.5 w-3.5 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen ? (
        <div className={`absolute right-0 z-50 max-h-72 w-72 max-w-[calc(100vw-2rem)] overflow-y-auto border border-stroke-default bg-surface-1 shadow-xl ${dropUp ? "bottom-full mb-1" : "top-full mt-1"}`}>
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

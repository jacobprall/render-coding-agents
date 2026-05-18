"use client";

import { useState, useTransition } from "react";
import useSWR from "swr";
import { useTheme } from "next-themes";
import { savePreferencesAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
import type { UserPreferencesData } from "@openforge/db/schema";

interface ModelOption {
  id: string;
  label: string;
  supportsThinking?: boolean;
}

async function modelsFetcher(url: string): Promise<ModelOption[]> {
  const r = await fetch(url);
  const data = (await r.json()) as { models?: ModelOption[] };
  return data.models ?? [];
}

export function PreferencesForm({ prefs }: { prefs: UserPreferencesData | null }) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { theme, setTheme } = useTheme();
  const { data: models = [], isLoading: modelsLoading } = useSWR("/api/models", modelsFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  const [defaultModelId, setDefaultModelId] = useState(prefs?.defaultModelId || "");
  const [subagentModelId, setSubagentModelId] = useState(prefs?.defaultSubagentModelId || "");

  function handleSubmit(formData: FormData) {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      const result = await savePreferencesAction(formData);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      }
    });
  }

  return (
    <form action={handleSubmit} className="space-y-8">
      {error && (
        <div className="border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="border border-primary/20 bg-primary/10 px-4 py-3 text-sm text-primary">
          Preferences saved successfully.
        </div>
      )}

      {/* Theme */}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-foreground">Appearance</h3>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Choose between dark and light mode.
        </p>
        <input type="hidden" name="theme" value={theme || "dark"} />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setTheme("dark")}
            className={`flex flex-col items-center gap-2 border p-4 transition-colors ${
              theme === "dark"
                ? "border-primary bg-primary/10"
                : "border-border hover:border-input"
            }`}
          >
            <Moon className="h-5 w-5" />
            <span className="text-sm font-medium">Dark</span>
          </button>
          <button
            type="button"
            onClick={() => setTheme("light")}
            className={`flex flex-col items-center gap-2 border p-4 transition-colors ${
              theme === "light"
                ? "border-primary bg-primary/10"
                : "border-border hover:border-input"
            }`}
          >
            <Sun className="h-5 w-5" />
            <span className="text-sm font-medium">Light</span>
          </button>
        </div>
      </section>

      {/* Models */}
      <section className="border border-border bg-card p-6 space-y-6">
        <h3 className="text-sm font-semibold text-foreground">Models</h3>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
            Default Model
          </label>
          <select
            name="defaultModelId"
            value={defaultModelId}
            onChange={(e) => setDefaultModelId(e.target.value)}
            className="flex h-9 w-full border border-input bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Select a model…</option>
            {modelsLoading ? (
              <option disabled>Loading models…</option>
            ) : (
              models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}{m.supportsThinking ? " (thinking)" : ""}
                </option>
              ))
            )}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">Model used for main agent sessions</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
            Default Subagent Model
          </label>
          <select
            name="defaultSubagentModelId"
            value={subagentModelId}
            onChange={(e) => setSubagentModelId(e.target.value)}
            className="flex h-9 w-full border border-input bg-transparent px-3 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">Same as main model</option>
            {modelsLoading ? (
              <option disabled>Loading models…</option>
            ) : (
              models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}{m.supportsThinking ? " (thinking)" : ""}
                </option>
              ))
            )}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">Model used for subagent tasks (optional)</p>
        </div>
      </section>

      {/* Workflow */}
      <section className="border border-border bg-card p-6 space-y-4">
        <h3 className="text-sm font-semibold text-foreground">Workflow</h3>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted-foreground">
            Diff Mode
          </label>
          <div className="flex gap-2">
            {(["unified", "split"] as const).map((mode) => (
              <label
                key={mode}
                className="flex cursor-pointer items-center gap-2 border border-input px-4 py-2 text-sm transition-colors has-checked:border-primary has-checked:bg-primary/10"
              >
                <input
                  type="radio"
                  name="defaultDiffMode"
                  value={mode}
                  defaultChecked={(prefs?.defaultDiffMode || "unified") === mode}
                  className="sr-only"
                />
                <span className="text-muted-foreground">{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center justify-between border border-input p-4 transition-colors hover:border-border">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Auto commit & push</div>
            <div className="text-xs text-muted-foreground/70">Automatically commit and push changes after agent runs</div>
          </div>
          <input
            type="checkbox"
            name="autoCommitPush"
            defaultChecked={prefs?.autoCommitPush ?? false}
            className="h-4 w-4 border-input bg-transparent text-primary focus:ring-ring focus:ring-offset-0"
          />
        </label>

        <label className="flex cursor-pointer items-center justify-between border border-input p-4 transition-colors hover:border-border">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Auto create PR</div>
            <div className="text-xs text-muted-foreground/70">Automatically create a pull request when work is complete</div>
          </div>
          <input
            type="checkbox"
            name="autoCreatePr"
            defaultChecked={prefs?.autoCreatePr ?? false}
            className="h-4 w-4 border-input bg-transparent text-primary focus:ring-ring focus:ring-offset-0"
          />
        </label>
      </section>

      {/* Submit */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={isPending}>
          {isPending && (
            <span className="inline-flex animate-spin">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </span>
          )}
          Save Preferences
        </Button>
      </div>
    </form>
  );
}

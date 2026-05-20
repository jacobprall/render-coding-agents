"use client";

import { useState, useTransition } from "react";
import useSWR from "swr";
import { Select } from "@/components/primitives/select";
import { apiFetch } from "@/lib/api-fetch";

interface ApiKeyRow {
  id: string;
  provider: "anthropic" | "openai";
  scope: "platform" | "user";
  label: string;
  keyHint: string;
  isValid: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ApiKeysPayload {
  encryptionConfigured: boolean;
  isAdmin: boolean;
  envFallback: { anthropic: boolean; openai: boolean };
  keys: ApiKeyRow[];
}

async function fetcher(url: string): Promise<ApiKeysPayload> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Failed to load API keys");
  return r.json() as Promise<ApiKeysPayload>;
}

export function ApiKeysManager() {
  const { data, error, isLoading, mutate } = useSWR("/api/settings/api-keys", fetcher);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [scope, setScope] = useState<"platform" | "user">("user");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");

  const effectiveScope = data && !data.isAdmin ? "user" : scope;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    startSaving(async () => {
      const { ok, data: j } = await apiFetch<{ error?: string }>("/api/settings/api-keys", {
        method: "POST",
        body: {
          provider,
          scope: effectiveScope,
          label: label.trim() || undefined,
          apiKey,
        },
      });
      if (!ok) {
        setFormError(typeof j.error === "string" ? j.error : "Save failed");
        return;
      }
      setApiKey("");
      setLabel("");
      await mutate();
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this stored API key?")) return;
    const { ok, data: j } = await apiFetch<{ error?: string }>(`/api/settings/api-keys/${id}`, { method: "DELETE" });
    if (!ok) {
      alert(typeof j.error === "string" ? j.error : "Delete failed");
      return;
    }
    await mutate();
  }

  if (isLoading || !data) {
    return <p className="text-sm text-text-tertiary">Loading…</p>;
  }
  if (error) {
    return <p className="text-sm text-danger">Could not load API keys.</p>;
  }

  return (
    <div className="space-y-8">
      {!data.encryptionConfigured && (
        <div className="border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-warning">
          Add{" "}
          <code className="rounded bg-surface-1 px-1.5 py-0.5 text-xs text-text-secondary">ENCRYPTION_KEY</code> to{" "}
          <code className="rounded bg-surface-1 px-1.5 py-0.5 text-xs text-text-secondary">
            apps/web/.env.local
          </code>{" "}
          and{" "}
          <code className="rounded bg-surface-1 px-1.5 py-0.5 text-xs text-text-secondary">
            apps/agent/.env
          </code>{" "}
          (identical values; generate with{" "}
          <code className="text-xs text-text-secondary">openssl rand -hex 32</code>) before saving keys here.
        </div>
      )}

      <section className="border border-stroke-subtle bg-surface-1 p-6">
        <h3 className="text-sm font-semibold text-text-primary">Environment fallback</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          <code className="text-text-tertiary">ANTHROPIC_API_KEY</code> and{" "}
          <code className="text-text-tertiary">OPENAI_API_KEY</code> apply when no database key is resolved for
          that provider (personal → platform → environment).
        </p>
        <ul className="mt-3 space-y-1 text-sm text-text-tertiary">
          <li>Anthropic: {data.envFallback.anthropic ? "set in environment" : "not set in environment"}</li>
          <li>OpenAI: {data.envFallback.openai ? "set in environment" : "not set in environment"}</li>
        </ul>
      </section>

      <section>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">Stored keys</h3>
        {data.keys.length === 0 ? (
          <p className="text-sm text-text-tertiary">No keys stored in the database yet.</p>
        ) : (
          <ul className="space-y-2">
            {data.keys.map((k) => (
              <li
                key={k.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-stroke-subtle bg-surface-1 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-primary">{k.label}</span>
                    <span className="rounded-full border border-stroke-subtle px-2 py-0.5 text-[10px] uppercase text-text-tertiary">
                      {k.provider}
                    </span>
                    <span className="rounded-full border border-stroke-subtle px-2 py-0.5 text-[10px] uppercase text-text-tertiary">
                      {k.scope}
                    </span>
                    {!k.isValid && (
                      <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-warning">
                        Invalid
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-xs text-text-tertiary">Key {k.keyHint}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(k.id)}
                  className="shrink-0 border border-stroke-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-(--of-duration-instant) hover:border-danger/40 hover:text-danger"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border border-stroke-subtle bg-surface-1 p-6">
        <h3 className="mb-4 text-sm font-semibold text-text-primary">Add or replace key</h3>
        <p className="mb-4 text-xs text-text-tertiary">
          One key per provider per scope. Saving again updates the existing row. Keys are validated with the
          provider before they are stored.
        </p>
        {formError && (
          <div className="mb-4 border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
            {formError}
          </div>
        )}
        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-tertiary">Provider</label>
              <Select
                value={provider}
                onChange={(v) => setProvider(v as "anthropic" | "openai")}
                options={[
                  { value: "anthropic", label: "Anthropic" },
                  { value: "openai", label: "OpenAI" },
                ]}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-tertiary">Scope</label>
              <Select
                value={effectiveScope}
                onChange={(v) => setScope(v as "platform" | "user")}
                disabled={!data.isAdmin}
                options={[
                  { value: "user", label: "Personal (this account)" },
                  ...(data.isAdmin
                    ? [{ value: "platform", label: "Platform (all users)" }]
                    : []),
                ]}
              />
              {!data.isAdmin && (
                <p className="mt-1 text-[11px] text-text-tertiary">Only administrators can add platform keys.</p>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-tertiary">Label (optional)</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={provider === "anthropic" ? "Anthropic" : "OpenAI"}
              className="w-full border border-stroke-default bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-tertiary">API key</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              className="w-full border border-stroke-default bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              required
              minLength={8}
            />
            <p className="mt-1 text-xs text-text-tertiary">
              Stored encrypted (AES-256-GCM). The full key is never shown again after saving.
            </p>
          </div>
          <button
            type="submit"
            disabled={saving || !data.encryptionConfigured}
            className="bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors duration-(--of-duration-instant) hover:bg-accent/60 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save key"}
          </button>
        </form>
      </section>
    </div>
  );
}

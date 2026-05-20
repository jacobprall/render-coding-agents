"use client";

import { useState, useTransition, useCallback } from "react";
import useSWR from "swr";
import { Copy, Check, Key } from "lucide-react";
import { Select } from "@/components/primitives/select";
import { apiFetch } from "@/lib/api-fetch";

interface AccessToken {
  id: string;
  label: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface AccessTokensPayload {
  tokens: AccessToken[];
}

async function fetcher(url: string): Promise<AccessTokensPayload> {
  const r = await fetch(url);
  if (!r.ok) throw new Error("Failed to load access tokens");
  return r.json() as Promise<AccessTokensPayload>;
}

const EXPIRY_OPTIONS = [
  { value: "", label: "No expiration" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
];

export function AccessTokensManager() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/settings/access-tokens",
    fetcher,
  );
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState("");
  const [creating, startCreating] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!label.trim()) return;
      setFormError(null);
      startCreating(async () => {
        const { ok, data: result } = await apiFetch<{
          token?: string;
          error?: string;
        }>("/api/settings/access-tokens", {
          method: "POST",
          body: {
            label: label.trim(),
            expiresInDays: expiry ? Number(expiry) : null,
          },
        });
        if (!ok) {
          setFormError(
            typeof result.error === "string" ? result.error : "Creation failed",
          );
          return;
        }
        setNewToken(result.token ?? null);
        setLabel("");
        setExpiry("");
        await mutate();
      });
    },
    [label, expiry, mutate],
  );

  async function handleDelete(id: string) {
    if (!confirm("Revoke this access token? Any clients using it will lose access."))
      return;
    const { ok, data: result } = await apiFetch<{ error?: string }>(
      `/api/settings/access-tokens/${id}`,
      { method: "DELETE" },
    );
    if (!ok) {
      alert(typeof result.error === "string" ? result.error : "Revoke failed");
      return;
    }
    await mutate();
  }

  function handleCopy() {
    if (!newToken) return;
    navigator.clipboard.writeText(newToken);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (isLoading || !data) {
    return <p className="text-sm text-text-tertiary">Loading…</p>;
  }
  if (error) {
    return <p className="text-sm text-danger">Could not load access tokens.</p>;
  }

  return (
    <div className="space-y-6">
      {newToken && (
        <div className="border border-green-500/30 bg-green-500/10 p-4">
          <p className="mb-2 text-sm font-medium text-text-primary">
            Token created — copy it now, it won&apos;t be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-surface-0 px-3 py-2 font-mono text-xs text-text-primary">
              {newToken}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 border border-stroke-default p-2 text-text-secondary transition-colors hover:text-text-primary"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setNewToken(null)}
            className="mt-3 text-xs text-text-tertiary hover:text-text-primary"
          >
            Dismiss
          </button>
        </div>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          Active tokens
        </h3>
        {data.tokens.length === 0 ? (
          <p className="text-sm text-text-tertiary">
            No personal access tokens yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {data.tokens.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 border border-stroke-subtle bg-surface-1 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Key className="h-3.5 w-3.5 text-text-tertiary" />
                    <span className="font-medium text-text-primary">
                      {t.label}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-text-tertiary">
                    <span className="font-mono">{t.prefix}…</span>
                    <span>
                      Created{" "}
                      {new Date(t.createdAt).toLocaleDateString()}
                    </span>
                    {t.lastUsedAt && (
                      <span>
                        Last used{" "}
                        {new Date(t.lastUsedAt).toLocaleDateString()}
                      </span>
                    )}
                    {t.expiresAt && (
                      <span
                        className={
                          new Date(t.expiresAt) < new Date()
                            ? "text-danger"
                            : ""
                        }
                      >
                        {new Date(t.expiresAt) < new Date()
                          ? "Expired"
                          : `Expires ${new Date(t.expiresAt).toLocaleDateString()}`}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleDelete(t.id)}
                  className="shrink-0 border border-stroke-default px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-(--of-duration-instant) hover:border-danger/40 hover:text-danger"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border border-stroke-subtle bg-surface-1 p-6">
        <h3 className="mb-4 text-sm font-semibold text-text-primary">
          Generate new token
        </h3>
        {formError && (
          <div className="mb-4 border border-danger/20 bg-danger/10 px-4 py-3 text-sm text-danger">
            {formError}
          </div>
        )}
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-tertiary">
                Label
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Cursor MCP"
                className="w-full border border-stroke-default bg-surface-2 px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-tertiary">
                Expiration
              </label>
              <Select
                value={expiry}
                onChange={setExpiry}
                options={EXPIRY_OPTIONS}
                placeholder="No expiration"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={creating || !label.trim()}
            className="bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors duration-(--of-duration-instant) hover:bg-accent/60 disabled:opacity-50"
          >
            {creating ? "Generating…" : "Generate token"}
          </button>
        </form>
      </section>

      <section className="border border-stroke-subtle bg-surface-1 p-6">
        <h3 className="mb-2 text-sm font-semibold text-text-primary">
          Usage
        </h3>
        <p className="mb-3 text-xs text-text-tertiary">
          Add to your Cursor or Claude Desktop MCP config:
        </p>
        <pre className="overflow-x-auto rounded bg-surface-0 p-3 text-xs text-text-secondary">
{`{
  "mcpServers": {
    "forge": {
      "url": "https://<gateway-host>/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}`}
        </pre>
      </section>
    </div>
  );
}

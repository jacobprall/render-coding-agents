"use client";

import { useState, useEffect, useCallback } from "react";
import { Copy, Trash2, UserPlus, Check } from "lucide-react";

interface InviteSummary {
  id: string;
  email: string | null;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  expired: boolean;
}

interface CreatedInvite {
  id: string;
  email: string;
  expiresAt: string;
  inviteUrl: string;
}

export default function TeamPage() {
  const [invites, setInvites] = useState<InviteSummary[]>([]);
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<CreatedInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const loadInvites = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/invites");
      if (res.ok) {
        const data = await res.json();
        setInvites(data.invites);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadInvites(); }, [loadInvites]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLastCreated(null);
    setCreating(true);

    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setLastCreated(data.invite);
      setEmail("");
      loadInvites();
    } catch {
      setError("Something went wrong.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    try {
      await fetch(`/api/admin/invites/${id}`, { method: "DELETE" });
      loadInvites();
    } catch { /* ignore */ }
  }

  function handleCopy(url: string) {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const inputClass =
    "w-full border border-stroke-default bg-surface-2 px-4 py-2.5 text-sm text-text-primary placeholder-text-tertiary focus:border-accent focus:outline-none";

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Team Invites</h2>
        <p className="mt-1 text-sm text-text-secondary">
          Invite new users by email. They&apos;ll receive a link to set their password.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex gap-3">
        <input
          type="email"
          placeholder="colleague@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={creating || !email}
          className="flex shrink-0 items-center gap-2 bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          <UserPlus className="h-4 w-4" />
          {creating ? "Creating…" : "Invite"}
        </button>
      </form>

      {error && <p className="text-sm text-danger">{error}</p>}

      {lastCreated && (
        <div className="space-y-2 border border-accent/20 bg-accent-bg p-4">
          <p className="text-sm font-medium text-text-primary">
            Invite created for {lastCreated.email}
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate border border-stroke-default bg-surface-2 px-3 py-2 text-xs text-text-secondary">
              {lastCreated.inviteUrl}
            </code>
            <button
              onClick={() => handleCopy(lastCreated.inviteUrl)}
              className="flex shrink-0 items-center gap-1.5 border border-stroke-default px-3 py-2 text-xs text-text-secondary transition-colors hover:text-text-primary"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-xs text-text-tertiary">
            Share this link with the user. It expires on{" "}
            {new Date(lastCreated.expiresAt).toLocaleDateString()}.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-text-secondary">All invites</h3>
        {invites.length === 0 ? (
          <p className="text-sm text-text-tertiary">No invites yet.</p>
        ) : (
          <div className="divide-y divide-stroke-subtle border border-stroke-subtle">
            {invites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">
                    {inv.email ?? "—"}
                  </p>
                  <p className="text-xs text-text-tertiary">
                    Created {new Date(inv.createdAt).toLocaleDateString()}
                    {inv.redeemedAt
                      ? ` · Accepted ${new Date(inv.redeemedAt).toLocaleDateString()}`
                      : inv.expired
                        ? " · Expired"
                        : ` · Expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {inv.redeemedAt ? (
                    <span className="text-xs text-success">Accepted</span>
                  ) : inv.expired ? (
                    <span className="text-xs text-text-tertiary">Expired</span>
                  ) : (
                    <>
                      <span className="text-xs text-accent">Pending</span>
                      <button
                        onClick={() => handleRevoke(inv.id)}
                        className="text-text-tertiary transition-colors hover:text-danger"
                        title="Revoke invite"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

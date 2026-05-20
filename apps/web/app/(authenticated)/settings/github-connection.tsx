"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" />
    </svg>
  );
}

export function GitHubConnection() {
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);

  const justConnected = searchParams.get("connected") === "github";
  const oauthError = searchParams.get("error");

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/oauth/github/status");
      if (res.ok) {
        const data = await res.json();
        setConnected(data.connected);
        setUsername(data.username ?? null);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await fetch("/api/oauth/github/status", { method: "DELETE" });
      setConnected(false);
      setUsername(null);
    } catch { /* ignore */ }
    finally { setDisconnecting(false); }
  }

  return (
    <>
      {justConnected && (
        <div className="border border-success/20 bg-success/5 px-4 py-3 text-sm text-success">
          GitHub account connected successfully.
        </div>
      )}

      {oauthError && (
        <div className="border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
          Failed to connect GitHub: {oauthError.replace(/_/g, " ")}
        </div>
      )}

      <div className="border border-stroke-subtle">
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center bg-surface-3">
              <GitHubIcon className="h-5 w-5 text-text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">GitHub</p>
              {loading ? (
                <p className="text-xs text-text-tertiary">Loading…</p>
              ) : connected ? (
                <p className="text-xs text-text-secondary">
                  Connected as <span className="font-medium">{username}</span>
                </p>
              ) : (
                <p className="text-xs text-text-tertiary">Not connected</p>
              )}
            </div>
          </div>

          {!loading && (
            connected ? (
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="border border-stroke-default px-4 py-2 text-sm text-text-secondary transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
              >
                {disconnecting ? "Disconnecting…" : "Disconnect"}
              </button>
            ) : (
              <a
                href="/api/oauth/github"
                className="inline-flex items-center gap-2 bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/60"
              >
                <GitHubIcon className="h-4 w-4" />
                Connect GitHub
              </a>
            )
          )}
        </div>
      </div>
    </>
  );
}

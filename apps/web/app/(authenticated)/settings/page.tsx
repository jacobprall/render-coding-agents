import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { getSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { getUserPreferences } from "@/lib/db/loaders";
import { Disclosure } from "@/components/primitives/disclosure";
import { PreferencesForm } from "./preferences-form";
import { GitHubConnection } from "./github-connection";
import { AccessTokensManager } from "./api-keys/access-tokens-manager";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/");

  let prefs = null;
  try {
    const row = await getUserPreferences(String(session.userId));
    prefs = row?.data ?? null;
  } catch {
    // DB might not be ready
  }

  return (
    <div className="space-y-4">
      <Disclosure title="Profile" defaultOpen>
        <div className="flex items-center gap-4">
          {session.avatarUrl ? (
            <Image
              src={session.avatarUrl}
              alt={session.username}
              width={64}
              height={64}
              className="h-16 w-16 rounded-full border-2 border-stroke-default"
            />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 text-xl font-bold text-text-tertiary">
              {session.username.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{session.username}</h3>
            <p className="text-sm text-text-tertiary">{session.email}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-text-tertiary">
          Profile information is synced from your connected forge account.
        </p>
      </Disclosure>

      <Disclosure title="GitHub Connection" defaultOpen>
        <p className="mb-4 text-sm text-text-secondary">
          Connect your GitHub account to access repositories and create sessions.
        </p>
        <Suspense fallback={<div className="text-sm text-text-tertiary">Loading…</div>}>
          <GitHubConnection />
        </Suspense>
      </Disclosure>

      <Disclosure title="MCP Access Tokens" defaultOpen>
        <p className="mb-4 text-sm text-text-secondary">
          Generate tokens for authenticating MCP clients (Cursor, Claude Desktop) or API integrations.
        </p>
        <AccessTokensManager />
      </Disclosure>

      <Disclosure title="Preferences" defaultOpen>
        <PreferencesForm prefs={prefs} />
      </Disclosure>
    </div>
  );
}

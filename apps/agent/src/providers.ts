import { and, eq } from "drizzle-orm";
import { syncConnections } from "@coding-agents/db";
import type { PlatformDb } from "@coding-agents/platform";
import { createForgeProvider, type ForgeProvider } from "@coding-agents/platform/forge";
import {
  SharedHttpSandboxProvider,
  type SandboxAdapter,
  type SandboxSessionAuth,
} from "@coding-agents/sandbox";
import { exeDevProviderFromEnv } from "@coding-agents/sandbox/providers/exedev";
import type { SandboxProvider } from "@coding-agents/sandbox/provider";
import { decryptTokenSafe } from "@coding-agents/shared/lib/encryption";

// ─── Forge providers ─────────────────────────────────────────────────────────

/**
 * Build a ForgeProvider for the session's user.
 * Resolves the token from sync connections, falling back to env vars.
 */
export async function getForgeProviderForSession(
  db: PlatformDb,
  session: { forgeType: string | null; userId: string },
): Promise<ForgeProvider> {
  const [conn] = await db
    .select({ accessToken: syncConnections.accessToken })
    .from(syncConnections)
    .where(and(eq(syncConnections.userId, session.userId), eq(syncConnections.provider, "github")))
    .limit(1);

  const envFallback = process.env.GITHUB_TOKEN;
  const token = (conn?.accessToken ? decryptTokenSafe(conn.accessToken) : undefined) ?? envFallback;
  if (!token) {
    throw new Error(`No GitHub token found for user ${session.userId} — check sync connections or GITHUB_TOKEN env`);
  }

  return createForgeProvider({ token });
}

// ─── Sandbox provider ────────────────────────────────────────────────────────

const SANDBOX_PROVIDER_TYPE = process.env.SANDBOX_PROVIDER ?? "shared-http";

let _sandboxProvider: SandboxProvider | null = null;
let _sandboxProviderCreatedAt = 0;
const SANDBOX_PROVIDER_MAX_AGE_MS = 10 * 60 * 1000;

function buildSharedHttpProvider(): SharedHttpSandboxProvider {
  const host = process.env.SANDBOX_SERVICE_HOST;
  if (!host) throw new Error("SANDBOX_SERVICE_HOST not configured");
  const secret = process.env.SANDBOX_SHARED_SECRET;
  const sessionSecret = process.env.SANDBOX_SESSION_SECRET;
  const sessionAuth: SandboxSessionAuth | undefined = sessionSecret
    ? { secret: sessionSecret, userId: "coding-agents-agent" }
    : undefined;
  return new SharedHttpSandboxProvider(host, secret, sessionAuth);
}

function getSandboxProvider(): SandboxProvider {
  const now = Date.now();
  if (_sandboxProvider && now - _sandboxProviderCreatedAt < SANDBOX_PROVIDER_MAX_AGE_MS) {
    return _sandboxProvider;
  }

  if (SANDBOX_PROVIDER_TYPE === "exedev") {
    _sandboxProvider = exeDevProviderFromEnv();
  } else {
    _sandboxProvider = buildSharedHttpProvider();
  }

  _sandboxProviderCreatedAt = now;
  return _sandboxProvider;
}

export async function getAdapter(sessionId: string): Promise<SandboxAdapter> {
  try {
    const provider = getSandboxProvider();
    return await provider.provision(sessionId);
  } catch {
    _sandboxProvider = null;
    _sandboxProviderCreatedAt = 0;
    const provider = getSandboxProvider();
    return provider.provision(sessionId);
  }
}

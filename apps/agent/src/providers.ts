import { and, eq } from "drizzle-orm";
import { mirrors, syncConnections } from "@coding-agents/db";
import type { PlatformDb } from "@coding-agents/platform";
import { getDefaultForgeProvider, createForgeProvider, type ForgeProvider, type ForgeProviderType } from "@coding-agents/platform/forge";
import {
  SharedHttpSandboxProvider,
  type SandboxAdapter,
  type SandboxSessionAuth,
} from "@coding-agents/sandbox";
import { ExeDevSandboxProvider, exeDevProviderFromEnv } from "@coding-agents/sandbox/providers/exedev";
import type { SandboxProvider } from "@coding-agents/sandbox/provider";
import { decryptTokenSafe } from "@coding-agents/shared/lib/encryption";
import type { UpstreamMirrorInfo } from "./context/agent-context";

// ─── Forge providers ─────────────────────────────────────────────────────────

/** Fallback forge provider using env token (GitHub by default). */
export function getForgeProvider(): ForgeProvider {
  const token = process.env.GITHUB_TOKEN ?? "";
  return getDefaultForgeProvider(token);
}

/**
 * Build a ForgeProvider appropriate for the session's forge type.
 * Resolves the token from sync connections, falling back to env vars.
 */
export async function getForgeProviderForSession(
  db: PlatformDb,
  session: { forgeType: string | null; userId: string },
): Promise<ForgeProvider> {
  const forgeType = (session.forgeType ?? "github") as ForgeProviderType;

  const [conn] = await db
    .select({ accessToken: syncConnections.accessToken })
    .from(syncConnections)
    .where(and(eq(syncConnections.userId, session.userId), eq(syncConnections.provider, forgeType)))
    .limit(1);

  const envFallback = forgeType === "github"
    ? process.env.GITHUB_TOKEN
    : process.env.GITLAB_TOKEN;
  const token = (conn?.accessToken ? decryptTokenSafe(conn.accessToken) : undefined) ?? envFallback;
  if (!token) {
    throw new Error(`No ${forgeType} token found for user ${session.userId} — check sync connections or env`);
  }

  const baseUrl = forgeType === "github"
    ? "https://api.github.com"
    : "https://gitlab.com";

  return createForgeProvider({ type: forgeType, baseUrl, token });
}

/** Fire-and-forget: tell Forgejo to pull from upstream so the mirror reflects new branches. */
export function triggerMirrorSync(forge: ForgeProvider, owner: string, repo: string): void {
  forge.mirrors.sync(owner, repo).catch((err) => {
    console.warn(`[agent] mirror sync failed for ${owner}/${repo}:`, err);
  });
}

// ─── Mirror resolution ───────────────────────────────────────────────────────

/**
 * Extract (owner, repo) from a remote URL.
 * Handles https://github.com/user/repo.git, git@github.com:user/repo.git, etc.
 */
function parseRemoteUrl(url: string): { owner: string; repo: string } | null {
  const httpsMatch = url.match(/(?:https?:\/\/[^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  const sshMatch = url.match(/git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch?.[1] && sshMatch[2]) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

export function providerBaseUrl(provider: string): string {
  switch (provider) {
    case "github": return "https://api.github.com";
    case "gitlab": return "https://gitlab.com";
    default:
      throw new Error(`Unknown upstream provider: ${provider}`);
  }
}

export async function resolveUpstreamMirror(
  db: PlatformDb,
  repoPath: string,
): Promise<UpstreamMirrorInfo | undefined> {
  if (!repoPath) return undefined;

  const [mirrorRow] = await db
    .select({
      remoteRepoUrl: mirrors.remoteRepoUrl,
      direction: mirrors.direction,
      syncConnectionId: mirrors.syncConnectionId,
    })
    .from(mirrors)
    .where(eq(mirrors.localRepoPath, repoPath))
    .limit(1);

  if (!mirrorRow) return undefined;
  if (mirrorRow.direction !== "pull" && mirrorRow.direction !== "bidirectional") return undefined;

  const [conn] = await db
    .select({
      provider: syncConnections.provider,
      accessToken: syncConnections.accessToken,
    })
    .from(syncConnections)
    .where(eq(syncConnections.id, mirrorRow.syncConnectionId))
    .limit(1);

  if (!conn?.accessToken) return undefined;

  const parsed = parseRemoteUrl(mirrorRow.remoteRepoUrl);
  if (!parsed) return undefined;

  const provider = conn.provider as ForgeProviderType;
  const baseUrl = providerBaseUrl(provider);
  const forge = createForgeProvider({
    type: provider,
    baseUrl,
    token: decryptTokenSafe(conn.accessToken),
  });

  return {
    provider,
    remoteRepoUrl: mirrorRow.remoteRepoUrl,
    forge,
    remoteOwner: parsed.owner,
    remoteRepo: parsed.repo,
  };
}

// ─── Sandbox provider ────────────────────────────────────────────────────────

const SANDBOX_PROVIDER_TYPE = process.env.SANDBOX_PROVIDER ?? "shared-http";

let _sandboxProvider: SandboxProvider | null = null;
let _sandboxProviderCreatedAt = 0;
const SANDBOX_PROVIDER_MAX_AGE_MS = 10 * 60 * 1000; // 10 min

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

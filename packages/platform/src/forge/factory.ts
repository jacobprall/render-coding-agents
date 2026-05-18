/**
 * ForgeProviderFactory — creates ForgeProvider instances from config.
 *
 * Call `createForgeProvider(config)` to get a fully initialized provider.
 * The factory picks the correct adapter based on the `type` field.
 *
 * For the internal Forgejo instance, use `getDefaultForgeProvider(token)`.
 */

import type { ForgeProvider, ForgeProviderType } from "./provider";
import { ForgejoProvider } from "./forgejo-adapter";
import { GitHubProvider } from "./github-adapter";
import { GitLabProvider } from "./gitlab-adapter";

export interface ForgeProviderConfig {
  type: ForgeProviderType;
  baseUrl: string;
  token: string;
  webhookSecret?: string;
}

/**
 * Build a ForgeProvider from explicit config.
 */
export function createForgeProvider(config: ForgeProviderConfig): ForgeProvider {
  switch (config.type) {
    case "forgejo":
      return new ForgejoProvider(config.baseUrl, config.token, config.webhookSecret);

    case "github":
      return new GitHubProvider(config.baseUrl, config.token, config.webhookSecret);

    case "gitlab":
      return new GitLabProvider(config.baseUrl, config.token, config.webhookSecret);

    default:
      throw new Error(`Unknown forge provider type: ${config.type}`);
  }
}

/**
 * Shortcut: build a ForgeProvider for the internal Forgejo instance
 * using FORGEJO_URL from the environment.
 */
export function getDefaultForgeProvider(token: string): ForgeProvider {
  const baseUrl = process.env.FORGEJO_INTERNAL_URL ?? process.env.FORGEJO_URL ?? "http://localhost:3000";
  const webhookSecret = process.env.FORGEJO_WEBHOOK_SECRET;
  return createForgeProvider({ type: "forgejo", baseUrl, token, webhookSecret });
}

/**
 * Build a ForgeProvider matching the user's auth context.
 * Falls back to the internal Forgejo instance when forgeType is unset.
 */
export function getForgeProviderForAuth(auth: { forgeToken: string; forgeType?: ForgeProviderType }): ForgeProvider {
  const forgeType = auth.forgeType ?? "github";

  if (forgeType === "github") {
    return createForgeProvider({
      type: "github",
      baseUrl: "https://api.github.com",
      token: auth.forgeToken,
    });
  }
  if (forgeType === "gitlab") {
    return createForgeProvider({
      type: "gitlab",
      baseUrl: "https://gitlab.com",
      token: auth.forgeToken,
    });
  }

  return getDefaultForgeProvider(auth.forgeToken);
}

/**
 * ForgeProviderFactory — creates ForgeProvider instances.
 *
 * GitHub is the only supported provider.
 */

import type { ForgeProvider } from "./provider";
import { GitHubProvider } from "./github-adapter";

export interface ForgeProviderConfig {
  baseUrl?: string;
  token: string;
  webhookSecret?: string;
}

/**
 * Build a GitHub ForgeProvider from config.
 */
export function createForgeProvider(config: ForgeProviderConfig): ForgeProvider {
  const baseUrl = config.baseUrl ?? "https://api.github.com";
  return new GitHubProvider(baseUrl, config.token, config.webhookSecret);
}

/**
 * Build a ForgeProvider for the user's GitHub token.
 */
export function getForgeProviderForAuth(auth: { forgeToken: string }): ForgeProvider {
  return createForgeProvider({ token: auth.forgeToken });
}

/**
 * @deprecated Use getForgeProviderForAuth instead. Kept for backward compat during migration.
 */
export function getDefaultForgeProvider(token: string): ForgeProvider {
  return createForgeProvider({ token });
}

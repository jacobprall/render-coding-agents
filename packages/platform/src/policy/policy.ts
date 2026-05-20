import type { PermissionPolicy } from "./types";

// ---------------------------------------------------------------------------
// Default policy
// ---------------------------------------------------------------------------

export const DEFAULT_POLICY: PermissionPolicy = {
  tools: {
    allow: [],   // empty = allow all
    deny: [],
  },
  cost: {
    maxPerTask: 0,      // 0 = no hard limit
    maxPerTurn: 0,      // 0 = no hard limit
    warnAt: 0.8,        // warn at 80% of budget
  },
  credentials: {
    patterns: [
      // Common secret patterns — extend per deployment
      "sk-[A-Za-z0-9-_]{20,}",          // OpenAI / Anthropic style keys
      "ghp_[A-Za-z0-9]{36}",            // GitHub personal access tokens
      "xoxb-[0-9]+-[A-Za-z0-9-]+",      // Slack bot tokens
      "(?i)password\\s*[:=]\\s*\\S+",   // key=value password pairs
      "(?i)secret\\s*[:=]\\s*\\S+",     // key=value secret pairs
    ],
  },
  sandbox: {
    allowedCommands: [],
    deniedPaths: [
      "/etc/shadow",
      "/etc/passwd",
      "/etc/sudoers",
      "~/.ssh",
      "~/.aws",
      "~/.config/gcloud",
    ],
  },
};

// ---------------------------------------------------------------------------
// resolvePolicy — merge caller overrides on top of DEFAULT_POLICY
// ---------------------------------------------------------------------------

export function resolvePolicy(overrides?: Partial<PermissionPolicy>): PermissionPolicy {
  if (!overrides) return DEFAULT_POLICY;

  return {
    tools: { ...DEFAULT_POLICY.tools, ...overrides.tools },
    cost: { ...DEFAULT_POLICY.cost, ...overrides.cost },
    credentials: { ...DEFAULT_POLICY.credentials, ...overrides.credentials },
    sandbox: { ...DEFAULT_POLICY.sandbox, ...overrides.sandbox },
  };
}

// ---------------------------------------------------------------------------
// Permission policy types
// ---------------------------------------------------------------------------

export interface ToolPermissions {
  /** Tool names to explicitly allow. Empty = allow all. */
  allow: string[];
  /** Tool names to explicitly deny. Takes precedence over allow. */
  deny: string[];
}

export interface CostPermissions {
  /** Maximum USD spend per task (hard stop). 0 = no limit. */
  maxPerTask: number;
  /** Maximum USD spend per agent turn (hard stop). 0 = no limit. */
  maxPerTurn: number;
  /** Fraction [0, 1] of maxPerTask at which a warning is emitted. */
  warnAt: number;
}

export interface CredentialPermissions {
  /**
   * Regex patterns matched against tool outputs and agent messages.
   * Matches are redacted before being stored or streamed to clients.
   */
  patterns: string[];
}

export interface SandboxPermissions {
  /**
   * Shell command prefixes that are always allowed.
   * If empty, all commands are allowed (subject to deny list).
   */
  allowedCommands: string[];
  /** Filesystem path prefixes that are never readable or writable. */
  deniedPaths: string[];
}

export interface PermissionPolicy {
  tools: ToolPermissions;
  cost: CostPermissions;
  credentials: CredentialPermissions;
  sandbox: SandboxPermissions;
}

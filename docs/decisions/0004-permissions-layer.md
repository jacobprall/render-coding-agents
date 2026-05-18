# ADR-0004: Permissions layer

**Status:** Accepted  
**Date:** 2026-05-17

## Context

As OpenForge agents run on shared infrastructure and use caller-supplied API keys, there is a need to enforce guardrails at multiple levels:

- **Cost** — prevent runaway API spending on a single task or agent turn
- **Tools** — restrict which tools an agent may call (e.g., no shell access in a code-review-only session)
- **Credentials** — prevent secrets from being stored in message history or streamed to clients

These concerns were not addressed in the initial implementation. Each agent run spent freely, called any tool, and stored raw tool outputs that might contain credentials.

## Decision

Add `packages/platform/src/permissions/` with three independent, composable guards:

### CostGuard (`cost-guard.ts`)

```typescript
evaluateCost(state, additionalUsd, policy)
// → { action: "allow" | "warn" | "block", message? }
```

Enforces `maxPerTask` and `maxPerTurn` USD limits. Returns `"warn"` at `warnAt` fraction of the task budget (default 80%). Returns `"block"` when a limit is exceeded.

### ToolFilter (`tool-filter.ts`)

```typescript
evaluateTool(toolName, policy)
// → { allowed: true } | { allowed: false, reason }
```

Deny list takes precedence over allow list. Empty allow list = all tools permitted.

### CredentialRedactor (`credential-redactor.ts`)

```typescript
redactCredentials(text, policy)
// → text with secrets replaced by "[REDACTED]"
```

Applies regex patterns from the policy. Default patterns cover OpenAI keys, GitHub PATs, Slack bot tokens, and `password=` / `secret=` pairs. Invalid regex patterns are skipped (no crash).

### Policy resolution

```typescript
resolvePolicy(overrides?) → PermissionPolicy
```

Merges caller overrides on top of `DEFAULT_POLICY`. Sessions can specify per-session cost limits and tool restrictions via their `projectConfig`.

## Consequences

**Good:**
- Guards are pure functions — no side effects, trivially testable
- Composable: all three can be applied independently
- `DEFAULT_POLICY` has no hard limits, so existing behaviour is unchanged until callers opt in

**Required follow-up:**
- Guards are available but not yet wired into the agent's run loop. The agent worker needs to call `evaluateCost` after each LLM call, `evaluateTool` before each tool invocation, and `redactCredentials` before persisting tool outputs. This is tracked as a separate work item.

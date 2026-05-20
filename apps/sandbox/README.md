# @openforge/sandbox

Isolated Docker container that exposes filesystem, shell, git, and search operations over an internal HTTP API. The agent interacts with code exclusively through the sandbox adapter — never directly on disk.

## What's Inside

| Concern | Location |
|---------|----------|
| **Bun HTTP server** (runs inside the container) | `server/` |
| **Client adapter** (`HttpSandboxAdapter`) | `adapter.ts` |
| **Provider** (`SharedHttpSandboxProvider`) | `providers/shared-http.ts` |
| **Dockerfile** | `Dockerfile` |

## Adapter Interface

The `SandboxAdapter` exposes these operations per session:

- `exec` — run a shell command with optional timeout
- `readFile` / `writeFile` — file I/O
- `glob` / `grep` — file search and content search
- `git` — run git commands
- `snapshot` / `restore` — checkpoint and rollback the workspace
- `cloneWorkspace` — copy one session's workspace to another
- `verify` — run a set of check commands and report pass/fail

## Authentication

All endpoints require a Bearer token (`SANDBOX_SHARED_SECRET`), except `/health` which is unauthenticated. Session-scoped JWTs can be minted with `mintSandboxSessionToken` and verified with `verifySandboxSessionToken`.

## Default Image

The Dockerfile ships with **Node, Bun, Python, ripgrep, git, and standard build tools**. Add languages or tools by editing the Dockerfile.

## Package Exports

```
@openforge/sandbox          — SandboxAdapter, HttpSandboxAdapter, provider registry, session tokens
@openforge/sandbox/types     — ExecResult, FileReadResult, GlobResult, GrepResult, GitResult, …
@openforge/sandbox/interface — SandboxAdapter interface
@openforge/sandbox/provider  — SandboxProvider interface, register/get helpers
```

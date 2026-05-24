# BugBot Rules

## Review Focus

Review every PR for the following, in priority order:

### Critical (Block Merge)
- **Security vulnerabilities** — injection (SQL, XSS, command), auth bypass, exposed secrets, insecure deserialization, SSRF
- **Data loss risks** — destructive migrations without backup path, silent data truncation, race conditions on writes
- **Breaking changes** — API contract changes without versioning, removed public exports, changed function signatures

### Important (Request Changes)
- **Error handling gaps** — unhandled promise rejections, empty catch blocks, missing error boundaries, swallowed errors that should surface to users
- **Performance issues** — N+1 queries, unbounded fetches without pagination, missing indexes on queried columns, synchronous operations that should be async
- **Type safety** — `any` types, unsafe type assertions (`as`), missing null checks on optional values
- **Test coverage** — new code paths without tests, modified behavior without updated tests

### Advisory (Comment, Don't Block)
- Code clarity — confusing variable names, overly complex conditionals, functions doing too many things
- Convention consistency — patterns that diverge from established codebase patterns
- Documentation gaps — public APIs or complex logic without explanation

## Review Style

- Be specific. Reference exact lines. Explain *why* something is a problem, not just *what*.
- Suggest fixes with code snippets when possible.
- Do not flag style preferences that are already covered by the linter.
- Do not flag issues in generated code, lock files, or third-party vendored code.

## Autofix Policy

BugBot Autofix is enabled. When Autofix creates a fix PR:
- The fix must be scoped to the flagged issue only. No drive-by refactoring.
- The fix must pass all hooks (lint, typecheck, test).
- If the fix is non-trivial (>20 lines changed), flag for human review instead of autofixing.

## Scope Exclusions

Do not review:
- `.marathon/` — sprint artifacts and configuration
- `.cursor/` — agent configuration
- `*.lock` — package lock files
- `*.gen.*` — generated files
- `migrations/` — database migrations (reviewed separately during architect-review)

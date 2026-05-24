---
description: Code style conventions, naming, and formatting rules
globs: ["**/*"]
alwaysApply: true
---

# Code Style

These conventions apply to all code written by agents. Consistency across sprints is more important than any individual preference.

## General

- Write clear, self-documenting code. Comments explain *why*, not *what*.
- Do not add comments that narrate what the code does. Avoid `// Import the module`, `// Define the function`, `// Return the result`.
- Keep functions short. If a function exceeds ~40 lines, consider extracting.
- Prefer early returns over deeply nested conditionals.
- No `any` types. Use `unknown` and narrow with type guards when the type is genuinely unknown.

## Naming

- **Files:** kebab-case for all files (`user-service.ts`, `auth-middleware.ts`).
- **Variables/functions:** camelCase (`getUserById`, `isAuthenticated`).
- **Types/interfaces/classes:** PascalCase (`UserProfile`, `AuthService`).
- **Constants:** UPPER_SNAKE_CASE only for true constants (`MAX_RETRY_COUNT`). Regular `const` variables use camelCase.
- **Boolean variables:** prefix with `is`, `has`, `can`, `should` (`isLoading`, `hasPermission`).
- **Event handlers:** prefix with `handle` (`handleSubmit`, `handleClick`).

## Imports

- Use explicit named imports. No wildcard `import *` unless re-exporting from an index file.
- Group imports: external packages first, then internal modules, then relative imports. Separate groups with a blank line.
- No circular imports. If two modules need each other, extract the shared piece into a third module.

## Error Handling

- Use typed errors or error codes, not string comparisons.
- Every `try/catch` should handle the error meaningfully or re-throw. No empty catch blocks.
- Async functions: always handle promise rejections. No fire-and-forget promises without `.catch()` or `void` annotation.

## TypeScript

- Prefer `interface` for object shapes, `type` for unions, intersections, and mapped types.
- Use `readonly` for properties that should not be mutated after construction.
- Prefer `unknown` over `any`. Prefer type narrowing over type assertions.
- Use discriminated unions for state machines and variant types.

## Testing

- Test files mirror source files: `foo.ts` → `foo.test.ts`.
- Test names describe behavior, not implementation: `"returns 404 when user not found"` not `"test getUserById"`.
- No test-only code paths in production code. Use dependency injection instead.
- Tests must be deterministic. No reliance on timing, network, or random values without mocking.

## Git

- One logical change per commit. Do not bundle unrelated changes.
- Branch names follow: `sprint-{N}/task-{M}-{short-description}`.
- PR titles are descriptive: `"Add user authentication with Clerk"` not `"task 3"`.

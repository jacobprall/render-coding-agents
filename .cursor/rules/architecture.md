---
description: Architectural patterns and structural constraints for the codebase
globs: ["**/*"]
alwaysApply: true
---

# Architecture Rules

These rules are always active. Every agent inherits them automatically.

## Project Structure

- Follow the directory structure established in Sprint 1. Do not reorganize top-level directories without architect-review approval.
- New files go in the directory that matches their domain. When in doubt, check existing patterns in the codebase.
- Shared utilities live in a shared/common location. Do not duplicate utility code across features.

## Stack Compliance

- Read `.marathon/inputs/stack.md` for the authoritative tech stack. Do not introduce frameworks, languages, or runtimes not listed there.
- Use the ORM/query builder specified in `stack.md` for all database access. No raw SQL unless explicitly required for performance and documented.
- Use the testing framework specified in `stack.md`. Do not mix testing frameworks.

## Data Flow

- All database access goes through the service/data layer. Route handlers and UI components do not query the database directly.
- API endpoints validate input at the boundary. Use the validation library specified in `stack.md` (e.g., Zod).
- Errors are handled at the boundary and returned in a consistent format. Do not let unhandled exceptions reach the client.

## Dependencies

- Read `.marathon/inputs/constraints.md` for the approved dependency list.
- Before adding a new dependency, check if the functionality exists in the standard library or an already-installed package.
- If you need a dependency not on the approved list, stop and escalate per guardrails.md.

## File Organization

- One component per file for UI components.
- Co-locate tests with source files (e.g., `foo.ts` and `foo.test.ts` in the same directory), or in a parallel `__tests__/` directory — follow whichever pattern is already established.
- Co-locate types with the code that uses them. Shared types go in a dedicated types file.

## Sprint Context

- Read `.cursor/rules/sprint-context.md` before starting any task. It contains the current sprint's goals and what already exists in the codebase.
- Read `.marathon/memory/` for lessons from previous sprints that may affect your work.

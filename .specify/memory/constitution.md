<!-- Sync Impact Report
Version change: 0.0.0 → 1.0.0
Modified principles: N/A (initial constitution)
Added sections: Core Principles (9), Technology Stack Constraints, Development Workflow, Governance
Removed sections: None
Templates requiring updates:
  - .specify/templates/plan-template.md ⚠ pending (verify principle alignment)
  - .specify/templates/spec-template.md ⚠ pending (verify scope constraints)
  - .specify/templates/tasks-template.md ⚠ pending (verify task categorization)
Follow-up TODOs: None
-->

# Render Coding Agents Constitution

## Core Principles

### I. Simplicity

Every feature, abstraction, and dependency MUST justify its existence. Start with the
simplest solution that solves the problem. YAGNI applies by default — speculative
generality is a defect, not foresight.

- Prefer standard library and platform primitives over third-party packages when the
  difference in effort is small.
- Avoid premature abstraction: duplication is cheaper than the wrong abstraction.
- Configuration MUST use environment variables; no bespoke config frameworks.

**Rationale**: A codebase that agents and new contributors can read in hours, not weeks.

### II. Observability

The system MUST be debuggable without attaching a debugger. Every service emits
structured logs, and critical operations carry correlation IDs across service boundaries.

- All logs MUST be structured JSON in production (human-readable in development).
- Errors MUST include context: operation name, relevant IDs, and upstream error.
- Long-running operations (agent sessions, sandbox commands) MUST emit progress events
  consumable via streaming (SSE / Redis Streams).

**Rationale**: When an agent session fails at 2 AM, the logs alone must explain why.

### III. Modularity

The monorepo is organized into `apps/` (deployable services) and `packages/` (shared
libraries). Each boundary MUST be respected:

- No circular dependencies between packages.
- `packages/` MUST NOT import from `apps/`.
- Each package exposes a clear public API; internal modules are not importable by others.
- Shared types live in `packages/shared`; shared DB access lives in `packages/db`;
  domain logic lives in `packages/platform`.

**Rationale**: Independent deployability, testability, and clear ownership boundaries.

### IV. API-First

Every platform capability MUST be accessible through a well-defined API surface. The
web UI is one consumer — not the only consumer.

- The gateway exposes REST, SSE, and MCP endpoints for every operation.
- The CLI consumes the same gateway API as external MCP clients.
- Internal service-to-service communication uses typed function calls within the
  monorepo or HTTP between deployed services.

**Rationale**: Enables headless automation, third-party integrations, and the MCP
ecosystem without UI coupling.

### V. Reliability

The platform handles partial failures gracefully. Jobs survive restarts, messages are
not lost, and user-visible errors include actionable guidance.

- Agent jobs MUST be durable: backed by Redis Streams with acknowledgement.
- Idempotency MUST be maintained for operations that can be retried (session creation,
  sandbox commands).
- Timeouts MUST be explicit — no unbounded waits.
- Degraded mode is preferable to total failure (e.g., sandbox unreachable → inform user,
  do not crash the agent worker).

**Rationale**: Users trust a platform that recovers, not one that silently drops work.

### VI. Security

Untrusted code execution is sandboxed. Internal services operate with moderate trust
but enforce authentication at every external boundary.

- Sandbox containers MUST run with no network access to internal infrastructure.
- All external API endpoints MUST require authentication (OAuth, API key, or shared
  secret).
- Secrets MUST be encrypted at rest (`ENCRYPTION_KEY`) and never logged.
- GitHub tokens are scoped to the minimum permissions required and stored encrypted.
- Internal services MAY trust each other via shared secrets over private networks.

**Rationale**: The platform executes arbitrary user-directed code; the blast radius of
a compromised sandbox must be zero.

### VII. Testing Discipline

Test critical paths pragmatically. Coverage is a tool, not a target.

- Agent tool execution, session lifecycle, and auth flows MUST have test coverage.
- Pure utility functions and data transformations SHOULD have unit tests.
- Trivial wiring code (re-exports, simple pass-through) does NOT require tests.
- Integration tests are preferred over mocks for cross-service interactions (sandbox
  API, Redis Streams, database queries).

**Rationale**: Tests protect against regressions in code that matters; over-testing
trivial code wastes time and creates brittle suites.

### VIII. OSS-Friendly

The project MUST remain easy to fork, configure, and self-host.

- All required configuration MUST be documentable via `.env.example`.
- No hard dependency on proprietary services — every external integration (LLM
  provider, OAuth, deployment target) MUST be swappable via environment variables or
  provider interfaces.
- README MUST contain a working quick-start that gets a contributor from clone to
  running in under 10 minutes.
- License and contribution guidelines MUST be present and current.

**Rationale**: An open-source project that's hard to run isn't truly open.

### IX. Performance

The platform MUST stream responses and process work asynchronously. Blocking the
main thread or HTTP response is a defect.

- LLM responses MUST stream to clients in real time (SSE).
- Agent work MUST be processed via background workers (Redis Streams), never
  synchronously in request handlers.
- Database queries MUST use appropriate indexes; N+1 patterns are not acceptable.
- Bundle size for the web app MUST be monitored; heavy dependencies are lazy-loaded.

**Rationale**: Users watching an agent work expect real-time feedback, not spinners
hiding serial waterfalls.

## Technology Stack Constraints

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Bun | All apps and packages |
| Web framework | Next.js 15 (App Router) | RSC, streaming, server actions |
| API gateway | Hono | Lightweight, edge-compatible |
| Database | PostgreSQL 16 | Via Drizzle ORM |
| Queue / PubSub | Redis Streams | Job durability, consumer groups |
| Sandbox | Docker (Bun HTTP server) | Isolated code execution |
| LLM | Anthropic Claude (default) | Provider-swappable via env |
| Auth | NextAuth.js + GitHub OAuth | Web; API key for gateway |
| Monorepo | Turborepo (Bun workspaces) | Task caching, dependency graph |

Stack changes (adding a new runtime, ORM, or framework) require an Architecture
Decision Record in `docs/decisions/` and owner approval.

## Development Workflow

### Branching

- `main` is the stable branch. It SHOULD always be deployable.
- Feature work happens on topic branches (`feat/`, `fix/`, `chore/`).
- PRs are encouraged for non-trivial changes. Small fixes and documentation updates
  MAY be committed directly to `main` by maintainers.

### Local Development

- `bun install` → `bun run infra:up` → `bun run db:push` → `bun run dev` MUST work
  without additional steps beyond filling `.env`.
- Breaking local dev setup is treated as a high-priority bug.

### CI Expectations

- Type checking (`bun run typecheck`) MUST pass.
- Tests (`bun run test`) MUST pass.
- Linting errors introduced by a change MUST be fixed in the same PR.

### Commit Messages

Follow conventional commit format: `type(scope): description`
Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`

## Governance

This constitution provides strong guidance for all development on the Render Coding
Agents platform. It SHOULD be followed for all contributions. Exceptions are permitted
when documented with rationale in the relevant PR or ADR.

- **Authority**: This constitution is the authoritative reference for architectural and
  process decisions. When in conflict with other documentation, the constitution wins.
- **Amendments**: Only project owner(s) may amend this constitution. Proposed changes
  MUST be submitted as a PR with clear rationale and impact assessment.
- **Versioning**: The constitution follows semantic versioning (MAJOR.MINOR.PATCH).
  MAJOR for principle removals/redefinitions, MINOR for additions, PATCH for
  clarifications.
- **Compliance**: Contributors SHOULD verify their changes align with these principles.
  Reviewers MAY flag violations during review.

**Version**: 1.0.0 | **Ratified**: 2026-05-21 | **Last Amended**: 2026-05-21

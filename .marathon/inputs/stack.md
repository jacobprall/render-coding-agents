# Tech Stack

## Language & Runtime

- **TypeScript 5.x** — all packages, strict mode
- **Bun 1.2** — runtime, package manager, test runner, bundler
- **Node.js 22** — compatibility target for production deployments on Render

## Framework

- **Next.js 15** (App Router) — web dashboard (`apps/web`)
- **Hono 4** — API gateway (`apps/gateway`), lightweight HTTP routing with OpenAPI support
- **Custom worker** — agent orchestration (`apps/agent`), direct fetch against Anthropic/OpenAI APIs

## Database

- **PostgreSQL 16** via Drizzle ORM (`packages/db`)
- **Redis** (ioredis) — job queues, pub/sub for real-time events, session state caching

## Authentication

- **NextAuth v5** (Auth.js) with Drizzle adapter — web dashboard auth
- **Bearer token / API key** — gateway API authentication (hashed keys stored in `api_keys` table)

## Hosting & Deployment

- **Render** — all services deployed via `render.yaml` Blueprint
- Docker containers for sandbox/agent VMs
- PostgreSQL and Redis as Render managed services

## Design System

- **Tailwind CSS v4** + **Radix UI** primitives
- **Lucide** icons
- **class-variance-authority** + **tailwind-merge** for component variants
- Dark mode via `next-themes`

## Testing

- **Bun test** — unit and integration tests
- Playwright (planned) — e2e tests

## Third-Party Services

- **Anthropic API** — Claude models for agent inference
- **OpenAI API** — GPT models as fallback/alternative
- **GitHub/GitLab APIs** — forge operations (clone, PR, review)
- **Slack API** (planned) — notifications and trigger integration
- **Linear API** (planned) — issue delegation and status sync

## Package Manager

- **Bun** with workspaces (`bun.lock`)
- Turborepo for task orchestration (`turbo build`, `turbo typecheck`)

## Monorepo Structure

```
coding-agents/
├── apps/
│   ├── agent/        # Worker: agent loop, tools, LLM calls
│   ├── gateway/      # Hono API: REST + MCP endpoints
│   ├── web/          # Next.js dashboard UI
│   ├── sandbox/      # Docker-based isolated execution environment
│   └── cli/          # CLI tool (rca)
├── packages/
│   ├── db/           # Drizzle schema, migrations, queries
│   ├── platform/     # Shared platform types and utilities
│   └── shared/       # Cross-package shared code
├── specs/            # Spec-driven development artifacts
└── .marathon/        # Autonomous sprint configuration
```

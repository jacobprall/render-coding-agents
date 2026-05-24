# Constraints

## Performance Budgets

- Web dashboard LCP < 2.5s on 4G connection
- Gateway API response < 200ms p95 for non-streaming endpoints
- Agent tool execution timeout: 120s per tool call
- WebSocket/SSE event delivery latency < 500ms

## Security Requirements

- All user input must be validated and sanitized server-side (Zod schemas at boundaries)
- No secrets in client-side code or git history
- HTTPS everywhere (Render manages TLS)
- SQL injection prevention via Drizzle ORM (no raw SQL without parameterization)
- API keys stored hashed (bcrypt) — never in plaintext
- Agent sandboxes: network egress controls, path security validation
- Webhook payloads verified via signature (GitHub: `x-hub-signature-256`, Slack: signing secret)
- OAuth tokens encrypted at rest

## Accessibility Standards

- WCAG 2.1 AA compliance for the web dashboard
- All interactive elements must be keyboard accessible
- Color contrast ratios must meet AA minimums
- All images must have alt text
- Form fields must have associated labels

## Architectural Patterns

### Required

- Server Components by default in Next.js — Client Components only for interactivity
- All database access through `packages/db` — never in route handlers or components directly
- Hono routes use Zod-OpenAPI for request/response validation
- Agent tools use adapter pattern for external service calls (forge, sandbox, notifications)
- Event-driven architecture for triggers: InboundRouter → InboundDispatcher → job enqueue
- All cross-service communication via Redis pub/sub or direct HTTP (no shared memory)
- Typed errors with error codes — no string comparisons for error handling

### Prohibited

- No `any` types — use `unknown` and narrow
- No barrel exports (index.ts re-exports) except for package entry points
- No default exports except Next.js pages/layouts
- No direct Anthropic/OpenAI SDK calls outside `apps/agent` — all LLM interaction is agent-internal
- No polling for real-time data — use SSE/WebSocket/Redis pub/sub
- No circular imports between packages

## Dependency Policy

### Approved Dependencies

#### Runtime
- hono, @hono/zod-openapi, @hono/node-server
- next, react, react-dom
- drizzle-orm, drizzle-kit, postgres
- ioredis
- zod
- nanoid
- @modelcontextprotocol/sdk
- @radix-ui/* (any primitive)
- tailwind-merge, class-variance-authority, clsx
- lucide-react
- next-auth, @auth/drizzle-adapter
- swr
- react-markdown, remark-gfm, remark-breaks
- next-themes
- yaml
- shiki
- bcryptjs

#### Dev
- typescript
- turbo
- @tailwindcss/postcss, postcss, tailwindcss
- @types/* (any official type package)
- bun (test runner, bundler)

### Dependency Rules

- Prefer standard library over third-party where reasonable
- No dependencies with fewer than 1000 GitHub stars unless explicitly approved
- No dependencies without active maintenance (last commit > 6 months)
- New dependencies for Slack/Linear integrations will be approved as part of Epic 3 sprint planning

## Compliance

- No PII stored beyond what users explicitly provide (email, username)
- Logs must not contain secrets, API keys, or auth tokens
- Agent sandbox operations must be auditable via observability traces

## Test Coverage

- New features must include tests for critical paths
- Test coverage must not drop below current baseline
- Integration tests required for any new webhook/event handler
- Agent tool tests must cover happy path + error cases

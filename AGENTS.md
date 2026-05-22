# AGENTS.md

## Cursor Cloud specific instructions

### Architecture

This is a Bun monorepo (Turborepo) with three main runtime services:

| Service | Command | Port | Purpose |
|---------|---------|------|---------|
| **web** | `bun run web` | 4000 | Next.js 15 app (auth, UI, streaming) |
| **agent** | `bun run worker` | — | Background worker consuming Redis Streams |
| **gateway** | `bun run gateway` | 4100 | Hono headless API (REST/SSE/MCP) |

Infrastructure services (Docker Compose): Postgres on :5433, Redis on :6380, Sandbox on :3001.

### Starting the environment

1. Start Docker daemon: `sudo bash -c 'dockerd &>/var/log/dockerd.log &'` (wait ~3s)
2. Start infrastructure: `docker compose up -d` (from repo root)
3. The Docker Compose creates database `forge` but the app expects `forge_app`. Create it if first run:
   `docker exec workspace-postgres-1 psql -U forge -c "CREATE DATABASE forge_app;" 2>/dev/null || true`
4. Push schema: `bun run db:push`
5. Start web: `bun run web` (Next.js on port 4000)
6. Start worker: `bun run worker` (agent worker)
7. Health check: `curl http://localhost:4000/api/health`

### Environment variables

The `.env` file lives at the repo root. Apps pick it up via symlinks:
- `apps/web/.env -> /workspace/.env`
- `apps/agent/.env -> /workspace/.env`

These symlinks are NOT committed to git; create them if missing:
```
ln -sf /workspace/.env /workspace/apps/web/.env
ln -sf /workspace/.env /workspace/apps/agent/.env
```

### Common commands

See `package.json` root scripts. Key ones:
- `bun run typecheck` — TypeScript checking across all packages
- `bun run test` — Bun tests (some tests have pre-existing module resolution failures)
- `bun run db:push` — Push Drizzle schema to Postgres
- `bun run db:studio` — Drizzle Studio UI on :4983

### Gotchas

- `bun run dev` (turbo dev) fails because the CLI app's `dev` script exits immediately. Use `bun run web` and `bun run worker` separately instead.
- The `DATABASE_URL` in `.env.example` references `forge_app` database, but Docker Compose only creates `forge`. You must manually create `forge_app` (see startup steps above).
- Admin credentials (set in `.env`): email `admin@example.com`, password from `ADMIN_PASSWORD`. The admin is auto-seeded on first web startup.
- 6 of 87 tests fail due to pre-existing module resolution issues (missing `packages/ui`, stale `packages/sandbox` imports, missing `chats` export from `packages/db`). These are not related to environment setup.

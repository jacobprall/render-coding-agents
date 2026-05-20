# Build from the repository root so COPY paths match a monorepo layout:
#   docker build -f apps/gateway/Dockerfile .
# Render: dockerContext must be `.` (repo root), not `apps/gateway`.

# ---------------------------------------------------------------------------
# Stage 1: install dependencies
# ---------------------------------------------------------------------------
FROM oven/bun:1.2.19 AS install

WORKDIR /app

COPY package.json bun.lock ./

COPY apps/gateway/package.json apps/gateway/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY apps/cli/package.json apps/cli/package.json
COPY apps/sandbox/package.json apps/sandbox/package.json
COPY packages/platform/package.json packages/platform/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json

RUN bun install --frozen-lockfile --production

# ---------------------------------------------------------------------------
# Stage 2: production image
# ---------------------------------------------------------------------------
FROM oven/bun:1.2.19-slim AS production

WORKDIR /app

COPY --from=install /app/node_modules ./node_modules

COPY package.json bun.lock ./
COPY apps/gateway apps/gateway
COPY packages/platform packages/platform
COPY packages/shared packages/shared
COPY packages/db packages/db

ENV NODE_ENV=production
ENV GATEWAY_PORT=4100

EXPOSE 4100

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:4100/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

WORKDIR /app/apps/gateway

CMD ["bun", "run", "src/index.ts"]

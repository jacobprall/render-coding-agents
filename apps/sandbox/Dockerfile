# Build from the repository root so COPY paths match a monorepo layout:
#   docker build -f packages/sandbox/Dockerfile .
# Render: dockerContext must be `.` (repo root), not `packages/sandbox`.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
  curl \
  wget \
  git \
  python3 \
  python3-pip \
  python3-venv \
  ripgrep \
  fd-find \
  tar \
  unzip \
  build-essential \
  ca-certificates \
  gnupg \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/*

ENV BUN_INSTALL=/usr/local
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/usr/local/bin:$PATH"

RUN useradd -r -u 10001 -m -d /home/sandbox sandbox \
  && mkdir -p /workspace/snapshots /app \
  && chown -R sandbox:sandbox /workspace /app

RUN su sandbox -s /bin/bash -c 'git config --global user.email "agent@openforge.dev" \
  && git config --global user.name "Forge Agent" \
  && git config --global init.defaultBranch main'

WORKDIR /app

COPY --chown=sandbox:sandbox package.json bun.lock ./

# Stub package.json for every workspace member so bun can resolve the full workspace
COPY --chown=sandbox:sandbox apps/gateway/package.json apps/gateway/package.json
COPY --chown=sandbox:sandbox apps/web/package.json apps/web/package.json
COPY --chown=sandbox:sandbox apps/agent/package.json apps/agent/package.json
COPY --chown=sandbox:sandbox apps/cli/package.json apps/cli/package.json
COPY --chown=sandbox:sandbox packages/platform/package.json packages/platform/package.json
COPY --chown=sandbox:sandbox packages/shared/package.json packages/shared/package.json
COPY --chown=sandbox:sandbox packages/db/package.json packages/db/package.json
COPY --chown=sandbox:sandbox packages/skills/package.json packages/skills/package.json
COPY --chown=sandbox:sandbox packages/sandbox/package.json packages/sandbox/package.json
COPY --chown=sandbox:sandbox packages/render-client/package.json packages/render-client/package.json
COPY --chown=sandbox:sandbox packages/ui/package.json packages/ui/package.json

COPY --chown=sandbox:sandbox packages/sandbox ./packages/sandbox/
COPY --chown=sandbox:sandbox packages/shared ./packages/shared/
COPY --chown=sandbox:sandbox packages/db ./packages/db/

USER sandbox

RUN bun install

WORKDIR /app/packages/sandbox

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

EXPOSE 3001

CMD ["bun", "run", "server/server.ts"]

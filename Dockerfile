# One image for all Kiln backend services (API, worker, router) and the migration job.
# Which service runs is chosen by the `command` in docker-compose.yml.
#
#   docker compose up -d --build

FROM node:22-bookworm-slim

# git: the API clones repositories.
# openssl + ca-certificates: Prisma's query engine and HTTPS (clones, Neon, S3).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Prefer IPv4 when a host has both A and AAAA records (Neon endpoints do). Docker networks are
# usually IPv4-only, and Prisma's engine gives up after the first (IPv6) address fails.
RUN echo "precedence ::ffff:0:0/96  100" >> /etc/gai.conf

# Docker CLI (client only): the worker starts sandboxed build containers on the host's Docker
# daemon through the mounted /var/run/docker.sock.
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /app

# Install dependencies first (cached until a manifest or the lockfile changes).
# Only the backend workspaces are installed; the Next.js dashboard runs on the host via `bun dev`.
COPY package.json package-lock.json tsconfig.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/shared/prisma packages/shared/prisma
COPY services/api/package.json services/api/
COPY services/worker/package.json services/worker/
COPY services/router/package.json services/router/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --no-audit --no-fund \
      --include-workspace-root \
      --workspace=@deployx/shared \
      --workspace=@deployx/api \
      --workspace=@deployx/worker \
      --workspace=@deployx/router

# Source code
COPY packages packages
COPY services services

ENV NODE_ENV=production
CMD ["npm", "start", "-w", "@deployx/api"]

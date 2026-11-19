# Kiln

**A local-first, self-hosted auto-deployment platform, in the spirit of Vercel and Netlify.**
Paste a Git URL; Kiln clones the repo, detects the framework, builds it in a sandboxed worker, streams every
log line to the browser in real time, and serves the result on its own wildcard subdomain
(`http://<id>.localhost:3001`).

```
┌────────────────┐  POST /api/deployments   ┌──────────────────┐   git clone --depth 1
│  Web console   │ ───────────────────────► │  API / Uploader  │ ─────────────────────┐
│ (Next.js, SSE) │ ◄─── SSE: events, logs ── │ Express + SSE hub│                      ▼
└────────────────┘                          └──────┬───────────┘           ┌───────────────────┐
        ▲                                          │ LPUSH id              │  Object storage   │
        │                                          ▼                       │(SeaweedFS/S3/fs)  │
        │                                   ┌──────────────┐               │  source/<id>/…    │
        │        PUBLISH logs:<id>          │    Redis     │               │  dist/<id>/…      │
        └────────────────────────────────── │ queue·pubsub │               └─────────┬─────────┘
                                            └──────┬───────┘                         ▲   │
                                                   │ BRPOP (N slots)                 │   │
                                            ┌──────▼─────────────────────┐  upload   │   │
                                            │  Build worker pool         │ ──────────┘   │
                                            │  docker run node:22 …      │               │
                                            │  npm ci && npm run build   │               │
                                            └────────────────────────────┘               │
 Browser ── http://abc123.localhost:3001/about ──► Request router (Host → id → key) ◄─────┘
```

## Features

- **Repository uploader:** validates the URL, makes a shallow clone of the requested or default branch, records the
  commit metadata and snapshots the source into object storage.
- **Asynchronous build queue:** Redis `LPUSH`/`BRPOP` job queue. Workers run *N* concurrent slots and can be scaled
  horizontally by starting more processes.
- **Sandboxed builds:** each build runs in an ephemeral `node:22-alpine` container with memory, CPU and PID limits,
  `no-new-privileges` and a timeout.
- **Zero-config detection:** Vite, CRA, Next.js (export), Astro, SvelteKit, Gatsby, Docusaurus, Angular and plain
  static HTML; npm, pnpm, yarn and bun lockfiles.
- **Real-time logs:** every stdout and stderr line is written to a Redis list (for replay) and published over
  pub/sub, then fanned out to browsers over Server-Sent Events by a single subscriber connection.
- **Wildcard subdomain router:** maps `Host` to a deployment id and then to an object key. Supports clean URLs, SPA
  fallback, ETag/304 and immutable caching for fingerprinted assets, and shows branded *building*, *failed* and
  *not found* pages.
- **Operator console:** live deployment list with search and filters, stats, a pipeline visualiser, a live site
  preview, a virtualised ANSI-colour log terminal (search, timestamps, wrap, copy, download, fullscreen), an
  infrastructure view with worker heartbeats, dark/light themes, keyboard shortcuts and a responsive layout.
- **Pluggable storage:** an S3 driver (SeaweedFS, AWS S3, Cloudflare R2) or a local-disk driver with the same key layout.

## Tech stack

| Layer      | Tech                                                                               |
| ---------- | ---------------------------------------------------------------------------------- |
| Frontend   | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, react-virtuoso, Lucide |
| Backend    | Node.js 22, TypeScript, Express, simple-git, ioredis, AWS SDK v3                    |
| Data       | PostgreSQL + Prisma (source of truth), Redis (queue, pub/sub, live state), SeaweedFS/S3 |
| Infra      | Docker, Docker Compose; Neon for hosted Postgres                                   |
| Monorepo   | npm workspaces: `apps/dashboard`, `services/{api,worker,router}`, `packages/shared`|

## Project structure

```
apps/dashboard/         Next.js console
  src/app/              App Router routes: /, /new, /deployments/[id]
  src/views/            client views for each route
  src/components/       layout shell, log console, pipeline, UI primitives
  src/hooks/            SSE-backed deployments store, log stream, health
services/api/           Express REST + SSE, repository uploader
services/worker/        build worker pool (framework detection, Docker runner)
services/router/        wildcard subdomain → object storage
packages/shared/        types, config, Redis helpers, storage drivers (S3 / fs)
```

## Getting started

**Requirements:** Docker, plus Node.js 20.12+ (or Bun) for the console.

```bash
npm install                 # or: bun install
cp .env.example .env        # set S3_SECRET_KEY (openssl rand -hex 24)
npx neon login              # once; then pull the Neon connection strings into .env:
npx neon env pull
npm run services:up         # docker compose: Redis, SeaweedFS, migrations (to Neon), API, worker, router
bun dev                     # the Next.js console on :3000 (npm run dev works too)
```

| Command | What it does |
| ------- | ------------ |
| `npm run services:up` | Builds the service image and starts everything in Docker (`docker compose up -d --build`) |
| `npm run services:logs` | Follows API, worker and router logs |
| `npm run services:rebuild` | Rebuilds and restarts the three services after code changes |
| `npm run services:down` | Stops the stack (data is kept in Docker volumes) |
| `bun dev` / `npm run dev` | Console only, with hot reload |
| `npm run dev:all` | Runs every service on the host instead (needs `npm run infra:up` and a `.env`) |

Secrets (Neon connection strings, S3 keys) are read from `.env`, which git ignores. `docker-compose.yml` only
references them as `${...}` and refuses to start if one is missing. SeaweedFS enforces the S3 keys.

In Docker the worker builds each repo in a sibling container through the host's Docker socket, so
untrusted install and build scripts never run in the service containers or on your machine.

Open **http://localhost:3000**, click an example repo and press **Deploy**.
`*.localhost` resolves to 127.0.0.1 in all modern browsers, so wildcard subdomains need no DNS setup.
Object storage is SeaweedFS (S3 API on :8333, cluster status on http://localhost:9333). Any S3-compatible store
(AWS S3, Cloudflare R2) can replace it by changing `S3_ENDPOINT` and the keys.

### Database: Neon

Postgres is [Neon](https://neon.tech) (project linked in `neon.ts` / `.neon`). `neon env pull` writes two
connection strings into `.env`:

- `DATABASE_URL`: **pooled** (`-pooler` host), used by the services for queries.
- `DATABASE_URL_UNPOOLED`: **direct**, used by Prisma Migrate (`directUrl`); migrations fail through PgBouncer.

The `migrate` container applies pending migrations to Neon on every `services:up`. Browse data with
`npm run db:studio`.

> If your router's DNS can't resolve Neon hostnames (`P1001: Can't reach database server`), switch your
> machine's DNS to 1.1.1.1 / 8.8.8.8. The Docker services already use public DNS and prefer IPv4.

### Running without Docker

Set these in `.env` and run a local `redis-server`:

```
STORAGE_DRIVER=fs        # store objects on local disk under .data/storage
BUILD_ISOLATION=local    # run builds as host processes
```

> ⚠️ `BUILD_ISOLATION=local` runs the repository's install and build scripts directly on your machine. Only use it
> with repositories you trust.

## Data model

```
projects ──< deployments ──< build_logs
(one per repo)   (one per deploy)   (archived per line)
```

| Store | Holds | Why |
| ----- | ----- | --- |
| **PostgreSQL** | projects, deployments, archived build logs | relational, queryable (stats via `GROUP BY`), transactional status changes |
| **Redis** | job queue, live log buffer and pub/sub, worker heartbeats | fast and short-lived; the log buffer expires 1h after archiving |
| **Object storage** | `source/<id>/`, `dist/<id>/` | static files served by the router |

The schema is in [`packages/shared/prisma/schema.prisma`](packages/shared/prisma/schema.prisma).

## Authentication

Self-built JWT auth in the API (`services/api/src/auth/`), with users and sessions stored in Neon.

| Piece | How it works |
| ----- | ------------ |
| Access token | HS256 JWT, 15 minutes, kept **only in browser memory** and sent as `Authorization: Bearer` |
| Refresh token | 256-bit random value in an `HttpOnly; SameSite=Strict; Path=/api/auth` cookie; only its SHA-256 hash is stored |
| Rotation | Every refresh issues a new refresh token; replaying a rotated one revokes the whole sign-in (token family) |
| Passwords | Argon2id; constant-time "unknown email" path; Redis rate limits on login and sign-up |
| Google | OAuth 2.0 Authorization Code + PKCE + `state`, ID token verified against Google's keys, verified emails only |
| Ownership | Every deployment and project has an owner; all routes, stats and live streams are scoped to the signed-in user |
| CORS / CSRF | Credentials allowed only for the console origin; cookie endpoints require `X-Requested-With: kiln` |

Google sign-in is optional: create a Web OAuth client with redirect URI
`http://localhost:8000/api/auth/google/callback`, put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`, then
`docker compose up -d api`. The button appears automatically.

## API

| Method | Path                                   | Description                                    |
| ------ | -------------------------------------- | ---------------------------------------------- |
| POST   | `/api/auth/register` · `/login` · `/refresh` · `/logout` | Email + password auth; refresh/logout use the cookie |
| GET    | `/api/auth/google` → `/google/callback`  | Google sign-in (PKCE) |
| POST   | `/api/deployments`                     | `{ repoUrl, branch?, installCommand?, buildCommand?, outputDir? }` → 202 |
| GET    | `/api/deployments`                     | List deployments (newest first)                |
| GET    | `/api/deployments/:id`                 | Deployment details                             |
| POST   | `/api/deployments/:id/redeploy`        | New deployment with the same settings          |
| DELETE | `/api/deployments/:id`                 | Remove metadata, logs, source and output       |
| GET    | `/api/deployments/:id/logs`            | Full log history                               |
| GET    | `/api/deployments/:id/logs/stream`     | SSE: `history` event, then live `log` events   |
| GET    | `/api/events`                          | SSE: `deployment.updated` / `deployment.deleted` |
| GET    | `/api/stats` · `/api/health`           | Platform stats · service and worker health     |

## Design notes

- **Why SSE rather than WebSockets?** Log traffic only flows from server to client. SSE works over plain HTTP and
  reconnects automatically. The Next.js console connects straight to the API (`NEXT_PUBLIC_API_URL`, with CORS
  enabled), so streams aren't buffered by a proxy.
- **Next.js App Router.** Each route is a thin server component that sets page metadata and renders a client view.
  Data is live (SSE), so the views are client components, while the app shell, fonts (`next/font`) and theme script
  render on the server with no flash between themes.
- **Ordered, loss-free logs.** Each line gets a sequence number from Redis `INCR`. The client subscribes *before*
  replaying history and de-duplicates by sequence number, so lines emitted during the handover are neither lost nor
  duplicated. Writes are serialised per build, so stdout and stderr interleave correctly.
- **Smooth rendering under load.** Incoming lines are buffered and flushed to React at most once per animation
  frame, and the terminal is virtualised, so 25k-line builds stay at 60 fps.
- **Exactly-once builds.** A worker claims a job with a conditional
  `UPDATE deployments SET status='building' WHERE id=$1 AND status='queued'`. If the same id were delivered twice,
  only one worker would build it.
- **Hot and cold logs.** Lines stream through Redis while a build runs. When it finishes they're batch-inserted
  into Postgres and the Redis buffer expires. Readers fall back to Postgres transparently.
- **Immutable deployments.** Every deploy gets a fresh id and prefix (`dist/<id>/`), so rollback is just pointing
  at an older id, and fingerprinted assets can be cached forever.

## Roadmap

- GitHub webhooks for deploy-on-push, plus preview deployments per PR
- Custom domains and project aliases (`project.localhost` pointing at the latest ready deployment)
- Build cache for `node_modules` keyed by lockfile hash
- Server-side rendering runtimes (containers kept warm by the router)

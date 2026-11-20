import type { Deployment as DeploymentRow, Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { appUrl } from './config';
import { prisma } from './db';
import { keys } from './redis';
import type { Deployment, DeploymentStatus, LogLine, LogStream, PlatformEvent, PlatformStats } from './types';

/**
 * Data access for deployments.
 *  - PostgreSQL (Prisma) is the source of truth for deployments and archived logs.
 *  - Redis carries the realtime side: change events, live log lines and a short-lived log buffer.
 */

const MAX_LOG_LINES = 25_000;
/** How long live log buffers stay in Redis after being archived to Postgres. */
const LOG_BUFFER_TTL_SECONDS = 60 * 60;

// ── Mapping ────────────────────────────────────────────────────────────────────

/** Deployment rows are always loaded with their project's slug (for the app URL). */
const withSlug = { project: { select: { slug: true } } } as const;
type Row = DeploymentRow & { project?: { slug: string | null } | null };

/** DB row → API shape (epoch-ms timestamps, no nulls, BigInt → number). */
function toDeployment(row: Row): Deployment {
  return {
    id: row.id,
    ownerId: row.ownerId ?? undefined,
    repoUrl: row.repoUrl,
    branch: row.branch,
    status: row.status,
    url: row.url,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    startedAt: row.startedAt?.getTime(),
    finishedAt: row.finishedAt?.getTime(),
    buildDurationMs: row.buildDurationMs ?? undefined,
    commitSha: row.commitSha ?? undefined,
    commitMessage: row.commitMessage ?? undefined,
    commitAuthor: row.commitAuthor ?? undefined,
    framework: row.framework ?? undefined,
    packageManager: row.packageManager ?? undefined,
    installCommand: row.installCommand ?? undefined,
    buildCommand: row.buildCommand ?? undefined,
    outputDir: row.outputDir ?? undefined,
    workerId: row.workerId ?? undefined,
    fileCount: row.fileCount ?? undefined,
    totalBytes: row.totalBytes == null ? undefined : Number(row.totalBytes),
    error: row.error ?? undefined,
    pausedAt: row.pausedAt?.getTime(),
    appUrl: row.project?.slug ? appUrl(row.project.slug) : undefined,
  };
}

// ── Apps (projects): slugs and stable URLs ─────────────────────────────────────

/**
 * "ShrivastvAryan/bg-remover" → "shrivastvaryan-bg-remover". Always contains a hyphen, which build ids
 * never do, so the router can tell an app URL from a build URL.
 */
export function slugFor(repoUrl: string) {
  let s = projectName(repoUrl)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  if (!/^[a-z]/.test(s)) s = `app-${s}`;
  if (!s.includes('-')) s = `${s}-app`;
  return s;
}

/** Gives a project its slug if it has none, adding -2, -3… on collisions. */
async function ensureProjectSlug(projectId: string, repoUrl: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { slug: true } });
  if (project?.slug) return project.slug;
  const base = slugFor(repoUrl);
  for (let n = 1; n < 100; n++) {
    const slug = n === 1 ? base : `${base.slice(0, 44)}-${n}`;
    if (await prisma.project.findUnique({ where: { slug }, select: { id: true } })) continue; // taken
    try {
      await prisma.project.update({ where: { id: projectId }, data: { slug } });
      return slug;
    } catch (err) {
      if ((err as { code?: string }).code !== 'P2002') throw err; // taken in a race: try the next one
    }
  }
  throw new Error('Could not allocate an app slug');
}

/** Points the app's stable URL at its latest live build (or clears it when it has none). */
export async function refreshAppAlias(redis: Redis, projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      slug: true,
      deployments: { where: { status: 'ready' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
    },
  });
  if (!project?.slug) return null;
  const live = project.deployments[0]?.id ?? null;
  if (live) await redis.set(keys.alias(project.slug), live);
  else await redis.del(keys.alias(project.slug));
  return live;
}

/**
 * Router fallback when the alias isn't cached: which build an app slug serves.
 * `undefined` = no such app; `null` = the app exists but has no live build yet.
 */
export async function resolveAppSlug(redis: Redis, slug: string): Promise<string | null | undefined> {
  const cached = await redis.get(keys.alias(slug));
  if (cached) return cached;
  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true } });
  if (!project) return undefined;
  return refreshAppAlias(redis, project.id);
}

/** Startup task: give older projects a slug and (re)build every app alias. */
export async function syncAppAliases(redis: Redis) {
  const projects = await prisma.project.findMany({ select: { id: true, repoUrl: true, slug: true } });
  for (const p of projects) {
    if (!p.slug) await ensureProjectSlug(p.id, p.repoUrl);
    await refreshAppAlias(redis, p.id);
  }
  return projects.length;
}

export type DeploymentPatch = Partial<
  Omit<Deployment, 'id' | 'repoUrl' | 'url' | 'createdAt' | 'updatedAt' | 'pausedAt'>
> & { pausedAt?: number | null };

function toUpdateData(patch: DeploymentPatch): Prisma.DeploymentUpdateManyMutationInput {
  const { startedAt, finishedAt, totalBytes, pausedAt, ...rest } = patch;
  return {
    ...rest,
    ...(startedAt !== undefined && { startedAt: new Date(startedAt) }),
    ...(finishedAt !== undefined && { finishedAt: new Date(finishedAt) }),
    ...(totalBytes !== undefined && { totalBytes: BigInt(totalBytes) }),
    ...(pausedAt !== undefined && { pausedAt: pausedAt === null ? null : new Date(pausedAt) }),
  };
}

async function publish(redis: Redis, event: PlatformEvent) {
  await redis.publish(keys.events, JSON.stringify(event));
}

function projectName(repoUrl: string) {
  return new URL(repoUrl).pathname.replace(/^\/+|\.git$/g, '');
}

// ── Deployments ────────────────────────────────────────────────────────────────

export interface NewDeployment {
  id: string;
  ownerId: string;
  repoUrl: string;
  branch: string;
  url: string;
  installCommand?: string;
  buildCommand?: string;
  outputDir?: string;
}

/** Creates a deployment, creating its project (one per owner + repository) on first deploy. */
export async function createDeployment(redis: Redis, input: NewDeployment) {
  const { ownerId, ...fields } = input;
  let row = await prisma.deployment.create({
    data: {
      ...fields,
      owner: { connect: { id: ownerId } },
      project: {
        connectOrCreate: {
          where: { ownerId_repoUrl: { ownerId, repoUrl: input.repoUrl } },
          create: { repoUrl: input.repoUrl, name: projectName(input.repoUrl), owner: { connect: { id: ownerId } } },
        },
      },
    },
    include: withSlug,
  });
  // First deploy of this app: give it its stable URL slug.
  if (!row.project?.slug) {
    await ensureProjectSlug(row.projectId, row.repoUrl);
    row = (await prisma.deployment.findUniqueOrThrow({ where: { id: row.id }, include: withSlug }))!;
  }
  const deployment = toDeployment(row);
  await publish(redis, { type: 'deployment.updated', deployment });
  return deployment;
}

/**
 * Fetch one deployment. With `ownerId`, it only matches that user's deployment (API routes always pass it);
 * without, it's an internal lookup (worker, router).
 */
export async function getDeployment(id: string, ownerId?: string) {
  const row = await prisma.deployment.findFirst({ where: ownerId ? { id, ownerId } : { id }, include: withSlug });
  return row ? toDeployment(row) : null;
}

export async function listDeployments(ownerId: string, limit = 200) {
  const rows = await prisma.deployment.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: withSlug,
  });
  return rows.map(toDeployment);
}

/**
 * Applies a patch and broadcasts it. A cancelled deployment is final: patches never move it out of
 * `cancelled` (a worker or uploader racing the cancel just gets `null` back).
 * Returns null if the deployment was cancelled or deleted meanwhile.
 */
export async function updateDeployment(redis: Redis, id: string, patch: DeploymentPatch) {
  try {
    const { count } = await prisma.deployment.updateMany({
      where: { id, status: { not: 'cancelled' } },
      data: toUpdateData(patch),
    });
    if (count === 0) return null;
    if (patch.status === 'ready') {
      // A new live build: the app's stable URL now serves it.
      const row = await prisma.deployment.findUnique({ where: { id }, select: { projectId: true } });
      if (row) await refreshAppAlias(redis, row.projectId);
    }
    const deployment = (await getDeployment(id))!;
    await publish(redis, { type: 'deployment.updated', deployment });
    return deployment;
  } catch (err) {
    if ((err as { code?: string }).code === 'P2025') return null; // deleted meanwhile
    throw err;
  }
}

/**
 * Atomically moves a deployment from `queued` to `building`. The conditional UPDATE guarantees
 * that only one worker can claim a job, even if it were delivered twice.
 */
export async function claimDeployment(redis: Redis, id: string, workerId: string) {
  const { count } = await prisma.deployment.updateMany({
    where: { id, status: 'queued' },
    data: { status: 'building', startedAt: new Date(), workerId },
  });
  if (count === 0) return null;
  const deployment = (await getDeployment(id))!;
  await publish(redis, { type: 'deployment.updated', deployment });
  return deployment;
}

/**
 * Stops an in-progress deployment. The conditional UPDATE makes it race-free: only a deployment that
 * is still active becomes `cancelled`, and nothing moves it out again (see updateDeployment).
 * Then the job is pulled off the queue and every worker/uploader is told to abort it.
 * Returns the cancelled deployment, or null if it had already finished.
 */
export async function cancelDeployment(redis: Redis, id: string) {
  const before = await getDeployment(id);
  if (!before) return null;
  const now = Date.now();
  const { count } = await prisma.deployment.updateMany({
    where: { id, status: { in: ['cloning', 'queued', 'building', 'uploading'] } },
    data: {
      status: 'cancelled',
      error: 'Stopped by user',
      finishedAt: new Date(now),
      ...(before.startedAt && { buildDurationMs: now - before.startedAt }),
    },
  });
  if (count === 0) return null;
  await redis.lrem(keys.queue, 0, id);
  await redis.publish(keys.cancel, id);
  await appendLog(redis, id, 'stderr', '■ Deployment stopped by user');
  // Nobody else is working on a queued job, so archive its log here (worker/uploader do it otherwise).
  if (before.status === 'queued') await archiveLogs(redis, id).catch(() => {});
  const deployment = (await getDeployment(id))!;
  await publish(redis, { type: 'deployment.updated', deployment });
  return deployment;
}

/**
 * Fails a build nobody is working on any more (its worker or the API process died mid-way). Only applies if
 * the build is still in one of `from`, so it can't overwrite a build that finished or was stopped meanwhile.
 * Returns true if it was failed.
 */
export async function failAbandoned(redis: Redis, id: string, from: DeploymentStatus[], message: string) {
  const now = new Date();
  const row = await prisma.deployment.findUnique({ where: { id }, select: { startedAt: true } });
  const { count } = await prisma.deployment.updateMany({
    where: { id, status: { in: from } },
    data: {
      status: 'failed',
      error: message,
      finishedAt: now,
      ...(row?.startedAt && { buildDurationMs: now.getTime() - row.startedAt.getTime() }),
    },
  });
  if (count === 0) return false;
  await appendLog(redis, id, 'stderr', `✗ ${message}`);
  await archiveLogs(redis, id).catch(() => {});
  const deployment = await getDeployment(id);
  if (deployment) await publish(redis, { type: 'deployment.updated', deployment });
  return true;
}

/** Pause (stop serving) or resume a ready deployment. Returns null unless it is ready. */
export async function setPaused(redis: Redis, id: string, paused: boolean) {
  const { count } = await prisma.deployment.updateMany({
    where: { id, status: 'ready' },
    data: { pausedAt: paused ? new Date() : null },
  });
  if (count === 0) return null;
  // The router checks this key on every request (cheaper than a database lookup per asset).
  if (paused) await redis.set(keys.paused(id), '1');
  else await redis.del(keys.paused(id));
  const deployment = (await getDeployment(id))!;
  await publish(redis, { type: 'deployment.updated', deployment });
  return deployment;
}

export async function deleteDeployment(redis: Redis, id: string, ownerId?: string) {
  const row = await prisma.deployment.delete({ where: { id } }); // build_logs cascade
  await redis.del(keys.logs(id), keys.logSeq(id), keys.paused(id), keys.runtime(id)); // the worker removes the container
  // If that was the app's live build, its URL falls back to the previous live one.
  await refreshAppAlias(redis, row.projectId);
  await publish(redis, { type: 'deployment.deleted', id, ownerId });
}

/**
 * Deletes a whole app: every build of the project `id` belongs to, their logs, the app's URL and the project
 * itself. Builds still in progress are stopped first. Object storage is cleaned by the caller through
 * `removeFiles` (the API owns the storage client); server containers are removed by the worker when it sees
 * the `deployment.deleted` events. Returns the deleted build ids, or null if `id` isn't the owner's.
 */
export async function deleteApp(
  redis: Redis,
  id: string,
  ownerId: string,
  removeFiles: (buildId: string) => Promise<unknown>,
) {
  const build = await prisma.deployment.findFirst({ where: { id, ownerId }, select: { projectId: true } });
  if (!build) return null;
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: build.projectId },
    select: { slug: true, deployments: { select: { id: true, status: true } } },
  });

  // Stop anything still cloning, queued or building, so no worker writes output for a build we delete.
  for (const d of project.deployments)
    if (['cloning', 'queued', 'building', 'uploading'].includes(d.status)) await cancelDeployment(redis, d.id);

  const ids = project.deployments.map((d) => d.id);
  await Promise.all(ids.map((buildId) => removeFiles(buildId)));
  await prisma.project.delete({ where: { id: build.projectId } }); // deployments and build_logs cascade

  await redis.del(
    ...ids.flatMap((b) => [keys.logs(b), keys.logSeq(b), keys.paused(b), keys.runtime(b)]),
    ...(project.slug ? [keys.alias(project.slug)] : []),
  );
  for (const buildId of ids) await publish(redis, { type: 'deployment.deleted', id: buildId, ownerId });
  return ids;
}

export async function getStats(redis: Redis, ownerId: string): Promise<PlatformStats> {
  const [groups, avg, queueLength] = await Promise.all([
    prisma.deployment.groupBy({ by: ['status'], where: { ownerId }, _count: { _all: true } }),
    prisma.deployment.aggregate({
      where: { ownerId, status: 'ready', buildDurationMs: { not: null } },
      _avg: { buildDurationMs: true },
    }),
    redis.llen(keys.queue),
  ]);
  const byStatus = { cloning: 0, queued: 0, building: 0, uploading: 0, ready: 0, failed: 0, cancelled: 0 } as Record<
    DeploymentStatus,
    number
  >;
  for (const g of groups) byStatus[g.status] = g._count._all;
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const finished = byStatus.ready + byStatus.failed;
  return {
    total,
    byStatus,
    successRate: finished ? byStatus.ready / finished : null,
    avgBuildMs: avg._avg.buildDurationMs,
    queueLength,
  };
}

// ── Logs ───────────────────────────────────────────────────────────────────────

/** Append a log line: buffered in Redis for replay (RPUSH) and fanned out live (PUBLISH). */
export async function appendLog(redis: Redis, id: string, s: LogStream, m: string) {
  const n = await redis.incr(keys.logSeq(id));
  const line: LogLine = { n, t: Date.now(), s, m };
  const payload = JSON.stringify(line);
  await redis
    .multi()
    .rpush(keys.logs(id), payload)
    .ltrim(keys.logs(id), -MAX_LOG_LINES, -1)
    .publish(keys.logChannel(id), payload)
    .exec();
  return line;
}

/** Logs from the live Redis buffer if present, otherwise from the Postgres archive. */
export async function getLogs(redis: Redis, id: string): Promise<LogLine[]> {
  const raws = await redis.lrange(keys.logs(id), 0, -1);
  if (raws.length) return raws.map((r) => JSON.parse(r) as LogLine);
  const rows = await prisma.buildLog.findMany({ where: { deploymentId: id }, orderBy: { seq: 'asc' } });
  return rows.map((r) => ({ n: r.seq, t: r.timestamp.getTime(), s: r.stream, m: r.message }));
}

/**
 * Persists a finished deployment's logs to Postgres, then lets the Redis buffer expire.
 * Idempotent: re-archiving skips lines that are already stored.
 */
export async function archiveLogs(redis: Redis, id: string) {
  const raws = await redis.lrange(keys.logs(id), 0, -1);
  const lines = raws.map((r) => JSON.parse(r) as LogLine);
  for (let i = 0; i < lines.length; i += 1000) {
    await prisma.buildLog.createMany({
      data: lines.slice(i, i + 1000).map((l) => ({
        deploymentId: id,
        seq: l.n,
        timestamp: new Date(l.t),
        stream: l.s,
        message: l.m,
      })),
      skipDuplicates: true,
    });
  }
  await redis.multi().expire(keys.logs(id), LOG_BUFFER_TTL_SECONDS).expire(keys.logSeq(id), LOG_BUFFER_TTL_SECONDS).exec();
  return lines.length;
}

/** Factory for a logger bound to one deployment. */
export function createLogger(redis: Redis, id: string) {
  return {
    system: (m: string) => appendLog(redis, id, 'system', m),
    stdout: (m: string) => appendLog(redis, id, 'stdout', m),
    stderr: (m: string) => appendLog(redis, id, 'stderr', m),
  };
}

import type { Deployment as DeploymentRow, Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
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

/** DB row → API shape (epoch-ms timestamps, no nulls, BigInt → number). */
function toDeployment(row: DeploymentRow): Deployment {
  return {
    id: row.id,
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
  };
}

export type DeploymentPatch = Partial<
  Omit<Deployment, 'id' | 'repoUrl' | 'url' | 'createdAt' | 'updatedAt'>
>;

function toUpdateData(patch: DeploymentPatch): Prisma.DeploymentUpdateInput {
  const { startedAt, finishedAt, totalBytes, ...rest } = patch;
  return {
    ...rest,
    ...(startedAt !== undefined && { startedAt: new Date(startedAt) }),
    ...(finishedAt !== undefined && { finishedAt: new Date(finishedAt) }),
    ...(totalBytes !== undefined && { totalBytes: BigInt(totalBytes) }),
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
  repoUrl: string;
  branch: string;
  url: string;
  installCommand?: string;
  buildCommand?: string;
  outputDir?: string;
}

/** Creates a deployment, creating its project (one per repository) on first deploy. */
export async function createDeployment(redis: Redis, input: NewDeployment) {
  const row = await prisma.deployment.create({
    data: {
      ...input,
      project: {
        connectOrCreate: {
          where: { repoUrl: input.repoUrl },
          create: { repoUrl: input.repoUrl, name: projectName(input.repoUrl) },
        },
      },
    },
  });
  const deployment = toDeployment(row);
  await publish(redis, { type: 'deployment.updated', deployment });
  return deployment;
}

export async function getDeployment(id: string) {
  const row = await prisma.deployment.findUnique({ where: { id } });
  return row ? toDeployment(row) : null;
}

export async function listDeployments(limit = 200) {
  const rows = await prisma.deployment.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map(toDeployment);
}

export async function updateDeployment(redis: Redis, id: string, patch: DeploymentPatch) {
  try {
    const row = await prisma.deployment.update({ where: { id }, data: toUpdateData(patch) });
    const deployment = toDeployment(row);
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

export async function deleteDeployment(redis: Redis, id: string) {
  await prisma.deployment.delete({ where: { id } }); // build_logs cascade
  await redis.del(keys.logs(id), keys.logSeq(id));
  await publish(redis, { type: 'deployment.deleted', id });
}

export async function getStats(redis: Redis): Promise<PlatformStats> {
  const [groups, avg, queueLength] = await Promise.all([
    prisma.deployment.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.deployment.aggregate({
      where: { status: 'ready', buildDurationMs: { not: null } },
      _avg: { buildDurationMs: true },
    }),
    redis.llen(keys.queue),
  ]);
  const byStatus = { cloning: 0, queued: 0, building: 0, uploading: 0, ready: 0, failed: 0 } as Record<
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

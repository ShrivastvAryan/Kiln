import { spawn } from 'node:child_process';
import { failAbandoned, getStorage, keys, prisma, storageKeys, type Redis } from '@deployx/shared';

/**
 * Builds outlive the process that runs them only on paper: if a worker is restarted or crashes mid-build,
 * its deployments stay "building" forever and can't be deleted. This sweep (run by every worker) finds
 * those and fails them, and puts back queued jobs that fell out of the Redis queue.
 */

const ABANDONED =
  'The worker running this build stopped before it finished (Kiln was restarted or crashed). Redeploy to try again.';

/** A queued job missing from the queue this long is put back (covers a lost/flushed Redis). */
const QUEUE_GRACE_MS = 30_000;

function docker(args: string[]) {
  return new Promise<string>((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(out.trim()));
  });
}

/** Sandboxed install/build containers of a build (named deployx-<id>-<step>) outlive a killed worker. */
async function killBuildContainers(id: string) {
  const ids = (await docker(['ps', '-aq', '--filter', `name=^deployx-${id}-`])).split('\n').filter(Boolean);
  if (ids.length) await docker(['rm', '-f', ...ids]);
}

export async function recoverAbandoned(redis: Redis, isMine: (id: string) => boolean) {
  // 1. In a worker's hands, but that worker has stopped heartbeating (its key expires 10 s after it dies).
  const inFlight = await prisma.deployment.findMany({
    where: { status: { in: ['building', 'uploading'] } },
    select: { id: true, workerId: true },
  });
  for (const d of inFlight) {
    if (isMine(d.id)) continue;
    if (d.workerId && (await redis.exists(keys.worker(d.workerId)))) continue;
    if (!(await failAbandoned(redis, d.id, ['building', 'uploading'], ABANDONED))) continue;
    console.log(`[recovery] ${d.id}: worker ${d.workerId ?? '?'} is gone, marked failed`);
    await killBuildContainers(d.id);
    // Half-uploaded output must never be served. (A half-started server is removed by the runtime reconcile.)
    await (await getStorage()).deletePrefix(storageKeys.output(d.id)).catch(() => {});
  }

  // 2. Queued, but not in the queue: re-queue. Claims are atomic, so a duplicate entry is harmless.
  const queued = await prisma.deployment.findMany({
    where: { status: 'queued', updatedAt: { lt: new Date(Date.now() - QUEUE_GRACE_MS) } },
    select: { id: true },
  });
  if (queued.length) {
    const inQueue = new Set(await redis.lrange(keys.queue, 0, -1));
    for (const { id } of queued) {
      if (inQueue.has(id)) continue;
      await redis.rpush(keys.queue, id); // BRPOP takes from the right: it is picked up next
      console.log(`[recovery] ${id}: queued but missing from the queue, re-queued`);
    }
  }
}

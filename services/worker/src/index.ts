import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  appendLog,
  archiveLogs,
  claimDeployment,
  config,
  createRedis,
  downloadPrefix,
  getStorage,
  keys,
  storageKeys,
  updateDeployment,
  uploadDirectory,
  type LogStream,
  type Redis,
  type WorkerInfo,
} from '@deployx/shared';
import { detectBuildPlan, resolveOutputDir } from './detect';
import { publishFilter } from './publish';
import { CancelledError, runCommand } from './runner';
import { recoverAbandoned } from './recovery';
import { appDir, appsDir, reconcile, removeApp, startServer } from './runtime';

const redis = createRedis('worker');
const processId = `${os.hostname()}-${process.pid}`;
let shuttingDown = false;

/** Builds running in this process, so a "stop" from the console can abort them. */
const running = new Map<string, AbortController>();
const cancelSub = createRedis('worker-cancel');
cancelSub.on('ready', () => void cancelSub.subscribe(keys.cancel, keys.events));
cancelSub.on('message', (channel, message: string) => {
  if (channel === keys.cancel) return void running.get(message)?.abort();
  // A build went live or was deleted: stop server containers that should no longer run.
  try {
    const event = JSON.parse(message) as { type: string; deployment?: { status: string } };
    if (event.type === 'deployment.deleted' || event.deployment?.status === 'ready') void reconcileApps();
  } catch {
    /* not JSON */
  }
});

/** Server builds this process is still starting are left alone by the reconcile loop. */
const reconcileApps = () => reconcile(redis, () => new Set(running.keys()));

/** Serialises log writes so lines keep their order even when stdout/stderr interleave. */
function orderedLogger(r: Redis, id: string) {
  let chain = Promise.resolve();
  const write = (s: LogStream, m: string) => {
    chain = chain.then(() => appendLog(r, id, s, m).then(() => undefined)).catch(() => undefined);
    return chain;
  };
  return {
    system: (m: string) => write('system', m),
    stdout: (m: string) => write('stdout', m),
    stderr: (m: string) => write('stderr', m),
    flush: () => chain,
  };
}

/** Prisma P1xxx = can't reach / lost the database (e.g. Neon waking from scale-to-zero, a network blip). */
const isConnectionError = (err: unknown) => /^P10\d\d$/.test(String((err as { code?: string })?.code ?? ''));

/**
 * Claim with retries. The job is already off the Redis queue at this point, so giving up on a transient
 * database error would leave the deployment "queued" forever: retry, and if the database is still
 * unreachable put the job back on the queue (the conditional claim makes a duplicate harmless).
 */
async function claimWithRetry(id: string, workerId: string) {
  const delays = [1000, 2000, 4000, 8000];
  for (let attempt = 0; ; attempt++) {
    try {
      return await claimDeployment(redis, id, workerId);
    } catch (err) {
      if (!isConnectionError(err)) throw err;
      if (attempt >= delays.length) {
        await redis.rpush(keys.queue, id); // BRPOP takes from the right: it is picked up next
        console.warn(`[worker ${workerId}] database unreachable, re-queued ${id}`);
        return null;
      }
      console.warn(`[worker ${workerId}] database unreachable claiming ${id}, retrying in ${delays[attempt]}ms`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

async function pathExists(p: string) {
  return fs.access(p).then(
    () => true,
    () => false,
  );
}

async function build(id: string, workerId: string) {
  // Atomic queued → building transition in Postgres: a job can only ever be built once.
  const deployment = await claimWithRetry(id, workerId);
  if (!deployment) return;

  const log = orderedLogger(redis, id);
  const started = deployment.startedAt ?? Date.now();
  const dir = path.join(config.dataDir, 'builds', id);
  const abort = new AbortController();
  running.set(id, abort);
  /** Between steps: stop here if the owner pressed Stop. */
  const checkpoint = () => {
    if (abort.signal.aborted) throw new CancelledError();
  };

  /** Set once the build folder becomes a server app's home: removed again if the deploy doesn't go live. */
  let serverDir: string | null = null;

  await log.system(`Build started on ${workerId} (isolation: ${config.worker.isolation})`);

  try {
    // 1. Fetch source snapshot from object storage
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const storage = await getStorage();
    const count = await downloadPrefix(storage, storageKeys.source(id), dir);
    await log.system(`Restored ${count} source files from storage`);
    checkpoint();

    // 2. Detect framework + commands (user overrides win)
    const plan = await detectBuildPlan(dir);
    const installCommand = deployment.installCommand ?? plan.installCommand;
    const buildCommand = deployment.buildCommand ?? plan.buildCommand;
    await updateDeployment(redis, id, { framework: plan.framework, packageManager: plan.packageManager });
    await log.system(`Detected framework: ${plan.framework}`);

    const exec = async (label: string, command: string) => {
      await log.system(`$ ${command}`);
      const t = Date.now();
      await runCommand({
        cwd: dir,
        command,
        name: `deployx-${id}-${label}`,
        timeoutMs: config.worker.timeoutMs,
        signal: abort.signal,
        onLine: (stream, line) => void (stream === 'stdout' ? log.stdout(line) : log.stderr(line)),
      });
      await log.system(`✓ ${label} finished in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    };

    // 3. Install + build
    if (installCommand) await exec('install', installCommand);
    if (buildCommand) await exec('build', buildCommand);
    else if (plan.packageManager !== 'none') await log.system('No "build" script found; deploying files as-is');

    checkpoint();

    // 4. Static site or Node server? A static export / built site wins; otherwise run the app's server.
    const isNext = plan.framework.startsWith('Next.js');
    let outputDir: string | null = null;
    if (deployment.outputDir) outputDir = await resolveOutputDir(dir, deployment.outputDir);
    else if (isNext) outputDir = (await pathExists(path.join(dir, 'out', 'index.html'))) ? 'out' : null;
    // A Node app with a "start" script and nothing to build is a server (Express, Fastify…), not a site.
    else if (!(plan.startCommand && !buildCommand)) outputDir = await resolveOutputDir(dir, plan.outputDir);

    const server = !outputDir && !deployment.outputDir ? plan.startCommand : undefined;
    if (server) {
      if (config.worker.isolation !== 'docker')
        throw new Error('This is a server app. Running server apps needs BUILD_ISOLATION=docker.');
      await log.system(`No static site in the build output: running it as a Node server (${server.framework})`);
      await updateDeployment(redis, id, { framework: server.framework, outputDir: isNext ? '.next' : '.' });
      checkpoint();

      // Keep the built folder (with node_modules) as the app's home and run it in its own container.
      serverDir = appDir(id);
      await fs.rm(serverDir, { recursive: true, force: true });
      await fs.mkdir(appsDir, { recursive: true });
      await fs.rename(dir, serverDir);
      await log.system(`$ ${server.command}`);
      await startServer({ redis, id, command: server.command, signal: abort.signal, log: (l) => log.stdout(l) });
      checkpoint();

      const finishedAt = Date.now();
      await log.system(`✓ Server is up. Deployment ready in ${((finishedAt - started) / 1000).toFixed(1)}s → ${deployment.url}`);
      await log.flush();
      const updated = await updateDeployment(redis, id, {
        status: 'ready',
        finishedAt,
        buildDurationMs: finishedAt - started,
      });
      if (!updated) await removeApp(redis, id); // stopped or deleted while starting
      else void reconcileApps(); // the app's previous live build stops serving
      return;
    }

    if (!outputDir) {
      throw new Error(
        deployment.outputDir
          ? `Output directory "${deployment.outputDir}" does not exist after build`
          : plan.serverApp
            ? `This looks like a ${plan.serverApp} app with no static site to serve. Kiln runs static sites and Node.js apps, so it can't run this server code.`
            : 'Could not find an index.html in the repository root or in dist/, build/, out/, public/ or _site/. Set the output directory manually.',
      );
    }
    const outPath = path.join(dir, outputDir);
    await log.system(`Using output directory: ${outputDir === '.' ? '(repository root)' : `${outputDir}/`}`);

    // 5. Upload artefacts
    checkpoint();
    await updateDeployment(redis, id, { status: 'uploading', outputDir });
    let lastReport = 0;
    const { fileCount, totalBytes } = await uploadDirectory(storage, outPath, storageKeys.output(id), {
      ignore: publishFilter(outputDir),
      onProgress: ({ done, total }) => {
        checkpoint(); // abort the upload between files
        if (done === total || Date.now() - lastReport > 750) {
          lastReport = Date.now();
          void log.system(`  uploaded ${done}/${total} assets`);
        }
      },
    });

    checkpoint();
    const finishedAt = Date.now();
    await log.system(`✓ Deployment ready in ${((finishedAt - started) / 1000).toFixed(1)}s → ${deployment.url}`);
    await log.flush();
    await updateDeployment(redis, id, {
      status: 'ready',
      finishedAt,
      buildDurationMs: finishedAt - started,
      fileCount,
      totalBytes,
    });
  } catch (err) {
    if (serverDir) await removeApp(redis, id);
    if (err instanceof CancelledError) {
      // Status is already `cancelled` (set by the API). Drop any half-uploaded output so it's never served.
      await log.system('Build process stopped.');
      await log.flush();
      await getStorage()
        .then((s) => s.deletePrefix(storageKeys.output(id)))
        .catch(() => {});
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    await log.stderr(`✗ Build failed: ${message}`);
    await log.flush();
    const finishedAt = Date.now();
    await updateDeployment(redis, id, {
      status: 'failed',
      error: message,
      finishedAt,
      buildDurationMs: finishedAt - started,
    });
  } finally {
    running.delete(id);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    // Persist the full build log to Postgres; Redis keeps it briefly for live viewers.
    await archiveLogs(redis, id).catch((err) => console.error(`[worker] archiving logs for ${id} failed`, err));
  }
}

/** One slot = one concurrent build. Each slot owns a blocking Redis connection. */
async function slot(index: number) {
  const workerId = `${processId}#${index + 1}`;
  const conn = createRedis(`worker-slot-${index}`);
  const info: WorkerInfo = {
    id: workerId,
    hostname: os.hostname(),
    pid: process.pid,
    isolation: config.worker.isolation,
    startedAt: Date.now(),
    busyWith: null,
    lastSeen: Date.now(),
  };
  const heartbeat = () =>
    redis.set(keys.worker(workerId), JSON.stringify({ ...info, lastSeen: Date.now() }), 'EX', 10).catch(() => {});
  await heartbeat();
  const timer = setInterval(heartbeat, 3000);

  while (!shuttingDown) {
    try {
      const job = await conn.brpop(keys.queue, 2);
      if (!job) continue;
      const id = job[1];
      info.busyWith = id;
      await heartbeat();
      console.log(`[worker ${workerId}] building ${id}`);
      await build(id, workerId);
      console.log(`[worker ${workerId}] finished ${id}`);
    } catch (err) {
      console.error(`[worker ${workerId}]`, err);
      await new Promise((r) => setTimeout(r, 1000));
    } finally {
      info.busyWith = null;
      await heartbeat();
    }
  }
  clearInterval(timer);
  await redis.del(keys.worker(workerId));
  conn.disconnect();
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(1);
    shuttingDown = true;
    console.log('[worker] finishing in-flight builds… (press again to force quit)');
  });
}

await getStorage();
// Fail builds whose worker died mid-way (e.g. this one, before a restart) and re-queue lost jobs.
const recover = () =>
  recoverAbandoned(redis, (id) => running.has(id)).catch((err) => console.error('[recovery] sweep failed', err));
setTimeout(() => void recover(), 12_000).unref(); // after a dead worker's heartbeat key (10 s) has expired
setInterval(() => void recover(), 30_000).unref();
if (config.worker.isolation === 'docker') {
  void reconcileApps();
  setInterval(() => void reconcileApps(), 30_000).unref();
}
console.log(
  `[worker] ${processId} started: ${config.worker.concurrency} slot(s), isolation=${config.worker.isolation}, storage=${config.storage.driver}`,
);
await Promise.all(Array.from({ length: config.worker.concurrency }, (_, i) => slot(i)));
redis.disconnect();
process.exit(0);

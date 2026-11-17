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
import { runCommand } from './runner';

const redis = createRedis('worker');
const processId = `${os.hostname()}-${process.pid}`;
let shuttingDown = false;

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

async function build(id: string, workerId: string) {
  // Atomic queued → building transition in Postgres: a job can only ever be built once.
  const deployment = await claimDeployment(redis, id, workerId);
  if (!deployment) return;

  const log = orderedLogger(redis, id);
  const started = deployment.startedAt ?? Date.now();
  const dir = path.join(config.dataDir, 'builds', id);

  await log.system(`Build started on ${workerId} (isolation: ${config.worker.isolation})`);

  try {
    // 1. Fetch source snapshot from object storage
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const storage = await getStorage();
    const count = await downloadPrefix(storage, storageKeys.source(id), dir);
    await log.system(`Restored ${count} source files from storage`);

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
        onLine: (stream, line) => void (stream === 'stdout' ? log.stdout(line) : log.stderr(line)),
      });
      await log.system(`✓ ${label} finished in ${((Date.now() - t) / 1000).toFixed(1)}s`);
    };

    // 3. Install + build
    if (installCommand) await exec('install', installCommand);
    if (buildCommand) await exec('build', buildCommand);
    else if (plan.packageManager !== 'none') await log.system('No "build" script found; deploying files as-is');

    // 4. Locate output
    const outputDir = await resolveOutputDir(dir, deployment.outputDir ?? plan.outputDir);
    if (!outputDir) {
      throw new Error(
        deployment.outputDir
          ? `Output directory "${deployment.outputDir}" does not exist after build`
          : 'Could not find build output (looked for dist/, build/, out/, public/ with an index.html). Set the output directory manually.',
      );
    }
    const outPath = path.join(dir, outputDir);
    await log.system(`Using output directory: ${outputDir === '.' ? '(repository root)' : `${outputDir}/`}`);

    // 5. Upload artefacts
    await updateDeployment(redis, id, { status: 'uploading', outputDir });
    let lastReport = 0;
    const { fileCount, totalBytes } = await uploadDirectory(storage, outPath, storageKeys.output(id), {
      ignore: (rel) => rel.split('/').some((s) => s === 'node_modules' || s === '.git'),
      onProgress: ({ done, total }) => {
        if (done === total || Date.now() - lastReport > 750) {
          lastReport = Date.now();
          void log.system(`  uploaded ${done}/${total} assets`);
        }
      },
    });

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
console.log(
  `[worker] ${processId} started: ${config.worker.concurrency} slot(s), isolation=${config.worker.isolation}, storage=${config.storage.driver}`,
);
await Promise.all(Array.from({ length: config.worker.concurrency }, (_, i) => slot(i)));
redis.disconnect();
process.exit(0);

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config, keys, prisma, type Redis, type RuntimeInfo } from '@deployx/shared';
import { CancelledError, heapFlag } from './runner';

/**
 * Server apps (Next.js with API routes / SSR, Node apps with a "start" script) can't be served from object
 * storage. Their build folder is kept under <dataDir>/apps/<id> and run as a long-lived, resource-limited
 * container; the router proxies requests to it. Only each app's live build keeps running: `reconcile` stops
 * superseded and deleted builds and revives live ones whose container went missing.
 */

export const APP_PORT = 3000;
export const appsDir = path.join(config.dataDir, 'apps');
export const appDir = (id: string) => path.join(appsDir, id);
const containerName = (id: string) => `kiln-app-${id}`;
const LABEL = 'kiln.runtime=1';

function docker(args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: err.message }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runContainer(id: string, command: string) {
  const name = containerName(id);
  await docker(['rm', '-f', name]);
  const { uid, gid } = os.userInfo();
  const heap = heapFlag(config.runtime.memory);
  const res = await docker([
    'run',
    '-d',
    '--name',
    name,
    '--init',
    '--restart',
    'unless-stopped',
    '--label',
    LABEL,
    '--label',
    `kiln.id=${id}`,
    `--memory=${config.runtime.memory}`,
    `--cpus=${config.runtime.cpus}`,
    '--pids-limit=256',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user',
    `${uid}:${gid}`,
    ...(config.runtime.network ? ['--network', config.runtime.network] : []),
    // Loopback only: for a router running on the host. In Docker the router uses the container name.
    '-p',
    `127.0.0.1::${APP_PORT}`,
    '-e',
    'HOME=/tmp',
    '-e',
    'NODE_ENV=production',
    '-e',
    `PORT=${APP_PORT}`,
    '-e',
    'HOSTNAME=0.0.0.0',
    '-e',
    'NEXT_TELEMETRY_DISABLED=1',
    ...(heap ? ['-e', `NODE_OPTIONS=${heap}`] : []),
    '-v',
    `${appDir(id)}:/app`,
    '-w',
    '/app',
    config.worker.image,
    'sh',
    '-c',
    command,
  ]);
  if (res.code !== 0) throw new Error(`Could not start the app container: ${res.stderr || res.stdout}`);
}

async function publishedPort(id: string) {
  const { stdout } = await docker(['port', containerName(id), `${APP_PORT}/tcp`]);
  const port = Number(stdout.split('\n')[0]?.split(':').pop());
  return Number.isFinite(port) && port > 0 ? port : undefined;
}

async function recordRuntime(redis: Redis, id: string, command: string) {
  const info: RuntimeInfo & { command: string } = {
    container: containerName(id),
    port: APP_PORT,
    hostPort: await publishedPort(id),
    command,
  };
  await redis.set(keys.runtime(id), JSON.stringify(info));
}

export async function containerLogs(id: string, lines = 40) {
  const { stdout, stderr } = await docker(['logs', '--tail', String(lines), containerName(id)]);
  return [stdout, stderr].filter(Boolean).join('\n');
}

/**
 * Starts the server for a build whose folder is already at appDir(id), and waits until it answers HTTP.
 * Throws (after removing the container) if it exits, keeps crashing or doesn't answer in time.
 */
export async function startServer(opts: {
  redis: Redis;
  id: string;
  command: string;
  signal: AbortSignal;
  log: (line: string) => unknown;
  timeoutMs?: number;
}) {
  const { redis, id, command, signal, log } = opts;
  const name = containerName(id);
  await runContainer(id, command);

  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  const probe = `fetch('http://127.0.0.1:${APP_PORT}/',{redirect:'manual'}).then(()=>process.exit(0),()=>process.exit(1))`;
  while (true) {
    if (signal.aborted) throw new CancelledError();
    const state = await docker(['inspect', '-f', '{{.State.Running}} {{.RestartCount}} {{.State.ExitCode}}', name]);
    const [running, restarts, exitCode] = state.stdout.split(' ');
    if (state.code !== 0 || running !== 'true' || Number(restarts) > 0) {
      const tail = await containerLogs(id);
      for (const line of tail.split('\n').filter(Boolean)) log(`  ${line}`);
      throw new Error(`The server exited during startup (exit code ${exitCode ?? '?'}). See the server output above.`);
    }
    // Any HTTP response (even a 404 or 500) means the server is listening.
    const ok = await docker(['exec', name, 'node', '-e', probe]);
    if (ok.code === 0) break;
    if (Date.now() > deadline) {
      const tail = await containerLogs(id);
      for (const line of tail.split('\n').filter(Boolean)) log(`  ${line}`);
      throw new Error(`The server didn't answer on port ${APP_PORT} within ${Math.round((opts.timeoutMs ?? 90_000) / 1000)}s.`);
    }
    await sleep(1000);
  }
  for (const line of (await containerLogs(id, 15)).split('\n').filter(Boolean)) log(`  ${line}`);
  await recordRuntime(redis, id, command);
}

/** Stops and deletes a build's server: container, folder and the router's record. Safe to call twice. */
export async function removeApp(redis: Redis, id: string) {
  await redis.del(keys.runtime(id));
  await docker(['rm', '-f', containerName(id)]);
  await fs.rm(appDir(id), { recursive: true, force: true }).catch(() => {});
}

let reconciling: Promise<void> | null = null;
let again = false;

/**
 * Brings running containers in line with the database: each app's live (latest ready) build runs; every other
 * server build is removed. `busy` holds builds this process is starting right now (left alone).
 */
export function reconcile(redis: Redis, busy: () => Set<string>) {
  if (reconciling) {
    again = true;
    return reconciling;
  }
  reconciling = (async () => {
    do {
      again = false;
      try {
        await reconcileOnce(redis, busy());
      } catch (err) {
        console.error('[runtime] reconcile failed', err);
      }
    } while (again);
  })().finally(() => (reconciling = null));
  return reconciling;
}

async function reconcileOnce(redis: Redis, busy: Set<string>) {
  const ps = await docker(['ps', '-a', '--filter', `label=${LABEL}`, '--format', '{{.Label "kiln.id"}}\t{{.State}}']);
  if (ps.code !== 0) return; // Docker unavailable: try again next time.
  const states = new Map<string, string>();
  for (const line of ps.stdout.split('\n').filter(Boolean)) {
    const [id, state] = line.split('\t');
    if (id) states.set(id, state);
  }
  const dirs = await fs.readdir(appsDir).catch(() => [] as string[]);
  const ids = [...new Set([...states.keys(), ...dirs])].filter((id) => !busy.has(id));
  if (!ids.length) return;

  const rows = await prisma.deployment.findMany({
    where: { id: { in: ids } },
    select: { id: true, status: true, projectId: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const live = new Map<string, string | undefined>();
  for (const projectId of new Set(rows.map((r) => r.projectId))) {
    const latest = await prisma.deployment.findFirst({
      where: { projectId, status: 'ready' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    live.set(projectId, latest?.id);
  }

  for (const id of ids) {
    const row = byId.get(id);
    const keep = row?.status === 'ready' && live.get(row.projectId) === id;
    if (!keep) {
      console.log(`[runtime] removing server for ${id} (${row ? 'superseded' : 'deleted'})`);
      await removeApp(redis, id);
      continue;
    }
    const raw = await redis.get(keys.runtime(id));
    const command = raw ? (JSON.parse(raw) as { command?: string }).command : undefined;
    const state = states.get(id);
    if (!state) {
      // Container gone (pruned, Docker reset) but the build is live: start it again from the kept folder.
      if (!command) continue;
      console.log(`[runtime] restarting missing server for ${id}`);
      await runContainer(id, command).catch((err) => console.error(`[runtime] ${id}:`, err.message));
    } else if (state === 'exited' || state === 'created') {
      await docker(['start', containerName(id)]);
    }
    // Published ports can change when a container restarts: keep the router's record current.
    if (command) await recordRuntime(redis, id, command);
  }
}

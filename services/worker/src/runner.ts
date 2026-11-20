import { spawn } from 'node:child_process';
import os from 'node:os';
import readline from 'node:readline';
import { config } from '@deployx/shared';

export interface RunOptions {
  cwd: string;
  command: string;
  /** Unique name, used as the container name so it can be killed on timeout. */
  name: string;
  onLine: (stream: 'stdout' | 'stderr', line: string) => void;
  timeoutMs: number;
  /** Aborting kills the command (the deployment was stopped by its owner). */
  signal?: AbortSignal;
}

/** Thrown when a command is killed because the deployment was stopped. */
export class CancelledError extends Error {
  constructor() {
    super('Deployment stopped by user');
  }
}

/**
 * Runs a shell command either inside an ephemeral, resource-limited Docker container
 * (default: untrusted code never touches the host) or as a local process.
 * Output is split into lines and streamed to `onLine` as it arrives.
 */
/** Docker memory string ("4g", "512m") → MiB, or null if it can't be parsed. */
function memoryMiB(limit: string) {
  const m = /^(\d+(?:\.\d+)?)([bkmg]?)$/i.exec(limit.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 'b').toLowerCase();
  return Math.floor(unit === 'g' ? n * 1024 : unit === 'm' ? n : unit === 'k' ? n / 1024 : n / 1024 / 1024);
}

/**
 * Node's default heap cap ignores the container limit: size it to ~75% of the limit so V8 collects garbage
 * before the kernel kills the process. Returns a NODE_OPTIONS value, or null if the limit can't be parsed.
 */
export function heapFlag(memoryLimit: string) {
  const mib = memoryMiB(memoryLimit);
  // IPv4 first: like the Kiln images (see Dockerfile), Docker networks are usually IPv4-only, and a failed
  // IPv6 attempt makes downloads during the build (e.g. next/font fetching Google Fonts) flaky.
  return mib ? `--max-old-space-size=${Math.max(256, Math.floor(mib * 0.75))} --dns-result-order=ipv4first` : null;
}
const buildHeap = heapFlag(config.worker.memory);

export function runCommand(opts: RunOptions): Promise<void> {
  const { cwd, command, name, onLine, timeoutMs, signal } = opts;
  if (signal?.aborted) return Promise.reject(new CancelledError());
  const docker = config.worker.isolation === 'docker';
  const { uid, gid } = os.userInfo();

  const child = docker
    ? spawn(
        'docker',
        [
          'run',
          '--rm',
          '--name',
          name,
          '--init',
          `--memory=${config.worker.memory}`,
          `--cpus=${config.worker.cpus}`,
          '--pids-limit=512',
          '--security-opt=no-new-privileges',
          // Run as the host user so build artifacts on the bind mount stay deletable.
          '--user',
          `${uid}:${gid}`,
          '-e',
          'HOME=/tmp',
          '-e',
          'npm_config_cache=/tmp/.npm',
          '-e',
          'FORCE_COLOR=1',
          ...(buildHeap ? ['-e', `NODE_OPTIONS=${buildHeap}`] : []),
          '-v',
          `${cwd}:/app`,
          '-w',
          '/app',
          config.worker.image,
          'sh',
          '-c',
          command,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
    : spawn('sh', ['-c', command], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, FORCE_COLOR: '1', npm_config_update_notifier: 'false' },
        detached: true, // own process group so we can kill the whole tree
      });

  const pipe = (stream: NodeJS.ReadableStream, kind: 'stdout' | 'stderr') => {
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (raw) => {
      // Progress bars rewrite the line with \r; keep only the final state.
      const line = raw.split('\r').filter(Boolean).pop() ?? '';
      if (line.trim()) onLine(kind, line);
    });
  };
  pipe(child.stdout!, 'stdout');
  pipe(child.stderr!, 'stderr');

  return new Promise((resolve, reject) => {
    let timedOut = false;
    let cancelled = false;
    const kill = () => {
      if (docker) spawn('docker', ['kill', name], { stdio: 'ignore' });
      else if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    const onAbort = () => {
      cancelled = true;
      kill();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(
        docker && (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error('Docker CLI not found. Install Docker or set BUILD_ISOLATION=local.')
          : err,
      );
    });
    child.on('close', (code, exitSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (cancelled) return reject(new CancelledError());
      if (timedOut) return reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s`));
      if (code === 0) return resolve();
      if (docker && code === 125)
        return reject(new Error('Docker failed to start the build container. Is the Docker daemon running?'));
      if (code === 137 || exitSignal === 'SIGKILL')
        return reject(
          new Error(
            docker
              ? `"${command}" ran out of memory and was killed (build limit: ${config.worker.memory}). Raise BUILD_MEMORY to give builds more room.`
              : `"${command}" was killed by the system, most likely because it ran out of memory.`,
          ),
        );
      reject(new Error(`Command "${command}" exited with ${exitSignal ?? `code ${code}`}`));
    });
  });
}

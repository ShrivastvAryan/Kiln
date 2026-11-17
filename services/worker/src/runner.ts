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
}

/**
 * Runs a shell command either inside an ephemeral, resource-limited Docker container
 * (default: untrusted code never touches the host) or as a local process.
 * Output is split into lines and streamed to `onLine` as it arrives.
 */
export function runCommand(opts: RunOptions): Promise<void> {
  const { cwd, command, name, onLine, timeoutMs } = opts;
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
    const timer = setTimeout(() => {
      timedOut = true;
      if (docker) spawn('docker', ['kill', name], { stdio: 'ignore' });
      else if (child.pid) process.kill(-child.pid, 'SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(
        docker && (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? new Error('Docker CLI not found. Install Docker or set BUILD_ISOLATION=local.')
          : err,
      );
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s`));
      if (code === 0) return resolve();
      if (docker && code === 125)
        return reject(new Error('Docker failed to start the build container. Is the Docker daemon running?'));
      reject(new Error(`Command "${command}" exited with ${signal ?? `code ${code}`}`));
    });
  });
}

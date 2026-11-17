import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleGit } from 'simple-git';
import {
  config,
  archiveLogs,
  createLogger,
  getStorage,
  keys,
  storageKeys,
  updateDeployment,
  uploadDirectory,
  type Deployment,
  type Redis,
} from '@deployx/shared';

const IGNORED = new Set(['.git', 'node_modules', '.next', '.cache', '.turbo']);
const MAX_REPO_FILES = 20_000;

/**
 * Repository uploader: shallow-clones the repo, snapshots its source tree into object storage,
 * then enqueues a build job. Runs in the background after the HTTP request has returned.
 */
export async function cloneAndEnqueue(redis: Redis, deployment: Deployment) {
  const { id, repoUrl, branch } = deployment;
  const log = createLogger(redis, id);
  const dir = path.join(config.dataDir, 'clones', id);
  const started = Date.now();

  try {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });

    await log.system(`Cloning ${repoUrl} (${branch ? `branch: ${branch}` : 'default branch'})`);
    // Minimal environment: simple-git rejects risky vars (EDITOR, GIT_ASKPASS…) from the parent env,
    // and git doesn't need anything else from the host.
    const git = simpleGit({ timeout: { block: 120_000 } }).env({
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
      GIT_TERMINAL_PROMPT: '0', // never hang waiting for credentials on private repos
    });
    await git.clone(repoUrl, dir, ['--depth', '1', '--single-branch', ...(branch ? ['--branch', branch] : [])]);

    const repo = simpleGit(dir);
    const resolvedBranch = branch || (await repo.revparse(['--abbrev-ref', 'HEAD'])).trim();
    const head = await repo.log({ maxCount: 1 });
    const commit = head.latest;
    if (commit) {
      await log.system(`Cloned commit ${commit.hash.slice(0, 7)}: "${commit.message}" by ${commit.author_name}`);
    }

    await log.system('Uploading source snapshot to object storage…');
    const storage = await getStorage();
    let lastReport = 0;
    const result = await uploadDirectory(storage, dir, storageKeys.source(id), {
      ignore: (rel) => rel.split('/').some((seg) => IGNORED.has(seg)),
      onProgress: ({ done, total }) => {
        if (total > MAX_REPO_FILES) throw new Error(`Repository too large (${total} files)`);
        if (done === total || Date.now() - lastReport > 1000) {
          lastReport = Date.now();
          void log.system(`  uploaded ${done}/${total} files`);
        }
      },
    });

    await updateDeployment(redis, id, {
      status: 'queued',
      branch: resolvedBranch,
      commitSha: commit?.hash,
      commitMessage: commit?.message,
      commitAuthor: commit?.author_name,
    });
    await redis.lpush(keys.queue, id);
    await log.system(
      `Source uploaded (${result.fileCount} files) in ${((Date.now() - started) / 1000).toFixed(1)}s. Queued for build.`,
    );
  } catch (err) {
    const message = friendlyGitError(err);
    await log.stderr(message);
    await updateDeployment(redis, id, { status: 'failed', error: message, finishedAt: Date.now() });
    await archiveLogs(redis, id).catch((e) => console.error('[api] archiving logs failed', e));
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function friendlyGitError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Remote branch .* not found/i.test(msg)) return `Branch not found. ${msg.split('\n')[0]}`;
  if (/could not read Username|Authentication failed|not found|404/i.test(msg))
    return 'Repository not found or is private. Only public repositories are supported.';
  if (/timed? ?out/i.test(msg)) return 'Clone timed out.';
  return `Clone failed: ${msg.trim().split('\n').slice(-1)[0]}`;
}

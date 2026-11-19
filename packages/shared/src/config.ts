import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

// Load the repo-level .env once (Node >= 20.12). Real env vars take precedence.
const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    /* ignore malformed .env */
  }
}

const env = (key: string, fallback: string) => {
  const raw = process.env[key];
  // Allow inline comments in .env values ("docker   # comment").
  const value = raw?.split(/\s+#/)[0].trim();
  return value ? value : fallback;
};
const num = (key: string, fallback: number) => Number(env(key, String(fallback)));
const resolvePath = (p: string) => (path.isAbsolute(p) ? p : path.join(ROOT_DIR, p));

export const config = {
  redisUrl: env('REDIS_URL', 'redis://127.0.0.1:6379'),
  rootDomain: env('ROOT_DOMAIN', 'localhost'),
  apiPort: num('API_PORT', 8000),
  routerPort: num('ROUTER_PORT', 3001),
  dataDir: resolvePath(env('DATA_DIR', '.data')),
  storage: {
    driver: env('STORAGE_DRIVER', 's3') as 's3' | 'fs',
    fsDir: resolvePath(env('FS_STORAGE_DIR', '.data/storage')),
    s3: {
      endpoint: env('S3_ENDPOINT', 'http://127.0.0.1:8333'),
      region: env('S3_REGION', 'us-east-1'),
      // No defaults for credentials: they must come from the environment (.env / docker-compose).
      accessKeyId: env('S3_ACCESS_KEY', ''),
      secretAccessKey: env('S3_SECRET_KEY', ''),
      bucket: env('S3_BUCKET', 'deployx'),
    },
  },
  worker: {
    concurrency: num('WORKER_CONCURRENCY', 2),
    isolation: env('BUILD_ISOLATION', 'docker') as 'docker' | 'local',
    image: env('BUILD_IMAGE', 'node:22-alpine'),
    timeoutMs: num('BUILD_TIMEOUT_MS', 10 * 60 * 1000),
    memory: env('BUILD_MEMORY', '1g'),
    cpus: env('BUILD_CPUS', '1.5'),
  },
};

/** Stable URL of an app: always serves its latest live build. */
export function appUrl(slug: string) {
  return deploymentUrl(slug);
}

export function deploymentUrl(id: string) {
  const port = config.routerPort === 80 ? '' : `:${config.routerPort}`;
  return `http://${id}.${config.rootDomain}${port}`;
}

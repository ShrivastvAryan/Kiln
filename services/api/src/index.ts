import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  ACTIVE_STATUSES,
  config,
  createDeployment,
  createRedis,
  cancelDeployment,
  deleteApp,
  setPaused,
  syncAppAliases,
  failAbandoned,
  prisma,
  deploymentUrl,
  getDeployment,
  getLogs,
  getStats,
  getStorage,
  keys,
  listDeployments,
  pingDatabase,
  storageKeys,
  type SystemHealth,
  type WorkerInfo,
} from '@deployx/shared';
import { authConfig } from './auth/config';
import { requireAuth } from './auth/middleware';
import { authRouter } from './auth/routes';
import { githubPublicRouter, githubRouter } from './github/routes';
import { RealtimeHub } from './realtime';
import { abortClone, cloneAndEnqueue } from './uploader';
import { ValidationError, generateId, parseCreateInput } from './validation';

const redis = createRedis('api');
const hub = new RealtimeHub();
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback, linklocal, uniquelocal'); // real client IP for rate limits behind Docker/proxies
app.use(express.json({ limit: '16kb' }));
app.use(cookieParser());

// CORS: only the Kiln console may call the API, with credentials (the refresh-token cookie).
app.use((req, res, next) => {
  const origin = req.get('origin');
  res.setHeader('Vary', 'Origin');
  if (origin && authConfig.dashboardOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// Public: sign-up, sign-in, refresh, Google OAuth, and GitHub's redirects back to Kiln.
app.use('/api/auth', authRouter(redis));
app.use('/api/github', githubPublicRouter(redis));

// Everything else requires a valid access token.
app.use('/api', requireAuth);
app.use('/api/github', githubRouter(redis));

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ── Deployments ────────────────────────────────────────────────────────────────

async function startDeployment(ownerId: string, input: ReturnType<typeof parseCreateInput>) {
  const id = generateId();
  const deployment = await createDeployment(redis, { id, ownerId, ...input, url: deploymentUrl(id) });
  void cloneAndEnqueue(redis, deployment); // fire-and-forget; progress is streamed via logs
  return deployment;
}

app.post(
  '/api/deployments',
  wrap(async (req, res) => {
    const input = parseCreateInput(req.body);
    res.status(202).json(await startDeployment(req.auth!.userId, input));
  }),
);

app.get(
  '/api/deployments',
  wrap(async (req, res) => {
    res.json(await listDeployments(req.auth!.userId));
  }),
);

app.get(
  '/api/deployments/:id',
  wrap(async (req, res) => {
    const d = await getDeployment(req.params.id, req.auth!.userId);
    if (!d) return res.status(404).json({ error: 'Deployment not found' });
    res.json(d);
  }),
);

app.post(
  '/api/deployments/:id/redeploy',
  wrap(async (req, res) => {
    const d = await getDeployment(req.params.id, req.auth!.userId);
    if (!d) return res.status(404).json({ error: 'Deployment not found' });
    const input = parseCreateInput(d);
    res.status(202).json(await startDeployment(req.auth!.userId, input));
  }),
);

/** Stop an in-progress deployment (clone, queue, build or upload). */
app.post(
  '/api/deployments/:id/cancel',
  wrap(async (req, res) => {
    const d = await getDeployment(req.params.id, req.auth!.userId);
    if (!d) return res.status(404).json({ error: 'Deployment not found' });
    const cancelled = await cancelDeployment(redis, d.id);
    if (!cancelled) return res.status(409).json({ error: 'This deployment has already finished' });
    abortClone(d.id); // if it's still cloning in this process
    res.json(cancelled);
  }),
);

/** Pause / resume serving a ready deployment. */
for (const [action, paused] of [
  ['pause', true],
  ['resume', false],
] as const) {
  app.post(
    `/api/deployments/:id/${action}`,
    wrap(async (req, res) => {
      const d = await getDeployment(req.params.id, req.auth!.userId);
      if (!d) return res.status(404).json({ error: 'Deployment not found' });
      const updated = await setPaused(redis, d.id, paused);
      if (!updated) return res.status(409).json({ error: 'Only a ready deployment can be paused or resumed' });
      res.json(updated);
    }),
  );
}

// Deleting removes the whole app: every build of it, with its files, logs, server and URL.
app.delete(
  '/api/deployments/:id',
  wrap(async (req, res) => {
    const storage = await getStorage();
    const deleted = await deleteApp(redis, req.params.id, req.auth!.userId, (buildId) =>
      Promise.all([storage.deletePrefix(storageKeys.source(buildId)), storage.deletePrefix(storageKeys.output(buildId))]),
    );
    if (!deleted) return res.status(404).json({ error: 'Deployment not found' });
    res.json({ deleted });
  }),
);

app.get(
  '/api/deployments/:id/logs',
  wrap(async (req, res) => {
    if (!(await getDeployment(req.params.id, req.auth!.userId))) return res.status(404).json({ error: 'Deployment not found' });
    res.json(await getLogs(redis, req.params.id));
  }),
);

// ── Realtime (Server-Sent Events) ─────────────────────────────────────────────

app.get('/api/events', (req, res) => hub.addEventClient(req, res, req.auth!.userId));

app.get(
  '/api/deployments/:id/logs/stream',
  wrap(async (req, res) => {
    const id = req.params.id;
    if (!(await getDeployment(id, req.auth!.userId))) return res.status(404).json({ error: 'Deployment not found' });
    await hub.addLogClient(req, res, id, () => getLogs(redis, id));
  }),
);

// ── Platform ───────────────────────────────────────────────────────────────────

app.get(
  '/api/stats',
  wrap(async (req, res) => {
    res.json(await getStats(redis, req.auth!.userId)); // aggregated in SQL (GROUP BY status, AVG duration)
  }),
);

async function listWorkers(): Promise<WorkerInfo[]> {
  const workerKeys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', keys.workerPattern, 'COUNT', 100);
    cursor = next;
    workerKeys.push(...batch);
  } while (cursor !== '0');
  if (!workerKeys.length) return [];
  const raws = await redis.mget(workerKeys);
  return raws
    .filter((r): r is string => !!r)
    .map((r) => JSON.parse(r) as WorkerInfo)
    .sort((a, b) => a.id.localeCompare(b.id));
}

app.get(
  '/api/health',
  wrap(async (_req, res) => {
    const storage = await getStorage().catch(() => null);
    const [databaseOk, redisOk, storageOk] = await Promise.all([
      pingDatabase(),
      redis
        .ping()
        .then(() => true)
        .catch(() => false),
      storage ? storage.ping() : Promise.resolve(false),
    ]);
    const health: SystemHealth = {
      database: databaseOk,
      redis: redisOk,
      storage: storageOk,
      storageDriver: config.storage.driver,
      workers: redisOk ? await listWorkers() : [],
    };
    res.json(health);
  }),
);

// ── Errors ─────────────────────────────────────────────────────────────────────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message, field: err.field });
  console.error('[api]', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function failAbandonedClones() {
  const startedAt = new Date();
  const rows = await prisma.deployment.findMany({
    where: { status: 'cloning', createdAt: { lt: startedAt } },
    select: { id: true },
  });
  let n = 0;
  for (const { id } of rows)
    if (await failAbandoned(redis, id, ['cloning'], 'Kiln restarted while cloning the repository. Redeploy to try again.')) n++;
  return n;
}

await getStorage();
await hub.start();
// Clones run inside this process, so any build still "cloning" now was abandoned by the previous API process.
failAbandonedClones()
  .then((n) => n && console.log(`[api] failed ${n} clone(s) abandoned by a restart`))
  .catch((err) => console.error('[api] checking abandoned clones failed', err));
// Older apps get their stable-URL slug, and every app URL is pointed at its latest live build.
syncAppAliases(redis)
  .then((n) => console.log(`[api] app URLs synced for ${n} app(s)`))
  .catch((err) => console.error('[api] syncing app URLs failed', err));
app.listen(config.apiPort, () => {
  console.log(`[api] listening on http://localhost:${config.apiPort} (storage: ${config.storage.driver})`);
});

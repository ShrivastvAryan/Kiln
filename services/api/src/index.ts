import express, { type NextFunction, type Request, type Response } from 'express';
import {
  ACTIVE_STATUSES,
  config,
  createDeployment,
  createRedis,
  deleteDeployment,
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
import { RealtimeHub } from './realtime';
import { cloneAndEnqueue } from './uploader';
import { ValidationError, generateId, parseCreateInput } from './validation';

const redis = createRedis('api');
const hub = new RealtimeHub();
const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  // The Next.js console runs on another origin, so answer CORS preflights directly.
  if (_req.method === 'OPTIONS') return res.status(204).end();
  next();
});

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ── Deployments ────────────────────────────────────────────────────────────────

async function startDeployment(input: ReturnType<typeof parseCreateInput>) {
  const id = generateId();
  const deployment = await createDeployment(redis, { id, ...input, url: deploymentUrl(id) });
  void cloneAndEnqueue(redis, deployment); // fire-and-forget; progress is streamed via logs
  return deployment;
}

app.post(
  '/api/deployments',
  wrap(async (req, res) => {
    const input = parseCreateInput(req.body);
    res.status(202).json(await startDeployment(input));
  }),
);

app.get(
  '/api/deployments',
  wrap(async (_req, res) => {
    res.json(await listDeployments());
  }),
);

app.get(
  '/api/deployments/:id',
  wrap(async (req, res) => {
    const d = await getDeployment(req.params.id);
    if (!d) return res.status(404).json({ error: 'Deployment not found' });
    res.json(d);
  }),
);

app.post(
  '/api/deployments/:id/redeploy',
  wrap(async (req, res) => {
    const d = await getDeployment(req.params.id);
    if (!d) return res.status(404).json({ error: 'Deployment not found' });
    const input = parseCreateInput(d);
    res.status(202).json(await startDeployment(input));
  }),
);

app.delete(
  '/api/deployments/:id',
  wrap(async (req, res) => {
    const d = await getDeployment(req.params.id);
    if (!d) return res.status(404).json({ error: 'Deployment not found' });
    if (ACTIVE_STATUSES.includes(d.status))
      return res.status(409).json({ error: 'Cannot delete a deployment while it is in progress' });
    const storage = await getStorage();
    await Promise.all([
      storage.deletePrefix(storageKeys.source(d.id)),
      storage.deletePrefix(storageKeys.output(d.id)),
    ]);
    await deleteDeployment(redis, d.id);
    res.status(204).end();
  }),
);

app.get(
  '/api/deployments/:id/logs',
  wrap(async (req, res) => {
    res.json(await getLogs(redis, req.params.id));
  }),
);

// ── Realtime (Server-Sent Events) ─────────────────────────────────────────────

app.get('/api/events', (req, res) => hub.addEventClient(req, res));

app.get(
  '/api/deployments/:id/logs/stream',
  wrap(async (req, res) => {
    const id = req.params.id;
    await hub.addLogClient(req, res, id, () => getLogs(redis, id));
  }),
);

// ── Platform ───────────────────────────────────────────────────────────────────

app.get(
  '/api/stats',
  wrap(async (_req, res) => {
    res.json(await getStats(redis)); // aggregated in SQL (GROUP BY status, AVG duration)
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

await getStorage();
await hub.start();
app.listen(config.apiPort, () => {
  console.log(`[api] listening on http://localhost:${config.apiPort} (storage: ${config.storage.driver})`);
});

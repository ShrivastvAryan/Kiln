import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  ACTIVE_STATUSES,
  config,
  createRedis,
  getDeployment,
  getStorage,
  keys,
  resolveAppSlug,
  storageKeys,
  type RuntimeInfo,
  type StoredObject,
} from '@deployx/shared';
import { statusPage } from './pages';
import { proxyRequest, proxyUpgrade, upstream } from './proxy';

const storage = await getStorage();
const redis = createRedis('router');
const SUFFIX = `.${config.rootDomain}`;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000';

/**
 * Map a request path to candidate object keys, in priority order:
 *   /about        → about, about.html, about/index.html
 *   /docs/        → docs/index.html
 *   /app/route    → … then SPA fallback index.html (only for extension-less paths)
 */
function candidates(urlPath: string) {
  let p = urlPath;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    /* keep raw */
  }
  const normalized = path.posix.normalize(p).replace(/^\/+/, '');
  if (normalized.startsWith('..')) return [];
  if (normalized === '' || normalized.endsWith('/')) return [`${normalized}index.html`, 'index.html'];
  const list = [normalized];
  const hasExt = path.posix.extname(normalized) !== '';
  if (!hasExt) list.push(`${normalized}.html`, `${normalized}/index.html`, 'index.html');
  return list;
}

function cacheControl(key: string) {
  if (key.endsWith('.html')) return 'no-cache';
  // Fingerprinted assets (e.g. assets/index-B2x9aQ.js) can be cached forever.
  if (/[.-][A-Za-z0-9_]{8,}\.(js|css|woff2?|png|jpe?g|svg|webp|avif)$/.test(key))
    return 'public, max-age=31536000, immutable';
  return 'public, max-age=300';
}

function html(res: http.ServerResponse, status: number, body: string) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const started = performance.now();
  const hostname = (req.headers.host ?? '').split(':')[0].toLowerCase();

  try {
    if (!hostname.endsWith(SUFFIX)) {
      return html(
        res,
        404,
        statusPage({
          code: 'Kiln Router',
          title: 'No deployment specified',
          message: `Deployments are served at http://<id>${SUFFIX}:${config.routerPort}.`,
          dashboard: `${dashboardUrl}/deployments`,
        }),
      );
    }

    const label = hostname.slice(0, -SUFFIX.length).split('.').pop()!;
    if (!ID_RE.test(label)) return html(res, 400, 'Bad host');

    // Build ids never contain "-"; app slugs always do. An app URL serves the app's latest live build.
    let id = label;
    if (label.includes('-')) {
      const target = await resolveAppSlug(redis, label);
      if (target === undefined) {
        return html(
          res,
          404,
          statusPage({
            code: '404 · Not found',
            title: 'App not found',
            message: `There is no app at "${label}". It may have been deleted.`,
            dashboard: `${dashboardUrl}/deployments`,
          }),
        );
      }
      if (target === null) {
        return html(
          res,
          503,
          statusPage({
            code: 'No live build',
            title: 'This app has no live build yet',
            message: 'It will appear here as soon as a build finishes. This page refreshes automatically.',
            refresh: true,
            dashboard: `${dashboardUrl}/deployments`,
          }),
        );
      }
      id = target;
    }

    // Paused flag and server record in one Redis round trip, no database lookup.
    const [paused, runtimeRaw] = await redis.mget(keys.paused(id), keys.runtime(id));
    if (paused) {
      return html(
        res,
        503,
        statusPage({
          code: 'Paused',
          title: 'This deployment is paused',
          message: 'Its owner has paused it for now. It will be back when they resume it.',
          dashboard: `${dashboardUrl}/deployments/${id}`,
        }),
      );
    }

    // A server app (Next.js with API routes, Node apps): forward everything to its container.
    if (runtimeRaw) {
      const target = upstream(JSON.parse(runtimeRaw) as RuntimeInfo);
      if (target) {
        try {
          await proxyRequest(req, res, target, id);
        } catch (err) {
          if (res.headersSent) return void res.destroy();
          console.error(`[router] upstream ${id}:`, (err as Error).message);
          return html(
            res,
            502,
            statusPage({
              code: '502 · App not responding',
              title: 'This app is not responding',
              message: 'Its server is restarting or has crashed. This page refreshes automatically.',
              refresh: true,
              dashboard: `${dashboardUrl}/deployments/${id}`,
            }),
          );
        }
        return;
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    const url = new URL(req.url ?? '/', 'http://x');
    let found: { key: string; obj: StoredObject } | null = null;
    for (const rel of candidates(url.pathname)) {
      const key = storageKeys.output(id) + rel;
      const obj = await storage.getObject(key);
      if (obj) {
        found = { key, obj };
        break;
      }
    }

    if (!found) {
      const deployment = await getDeployment(id);
      if (!deployment) {
        return html(
          res,
          404,
          statusPage({
            code: '404 · Not found',
            title: 'Deployment not found',
            message: `There is no deployment with id "${id}". It may have been deleted.`,
            dashboard: `${dashboardUrl}/deployments`,
          }),
        );
      }
      if (ACTIVE_STATUSES.includes(deployment.status)) {
        return html(
          res,
          503,
          statusPage({
            code: `Status · ${deployment.status}`,
            title: 'Deployment in progress',
            message: 'This page will refresh automatically when the build finishes.',
            refresh: true,
            dashboard: `${dashboardUrl}/deployments/${id}`,
          }),
        );
      }
      if (deployment.status === 'cancelled') {
        return html(
          res,
          410,
          statusPage({
            code: 'Stopped',
            title: 'This deployment was stopped',
            message: 'It was stopped before it finished building, so there is nothing to serve.',
            dashboard: `${dashboardUrl}/deployments/${id}`,
          }),
        );
      }
      if (deployment.status === 'ready' && deployment.framework?.endsWith('(server)')) {
        // A server build that is no longer the app's live build: its container was stopped.
        return html(
          res,
          410,
          statusPage({
            code: 'Not running',
            title: 'This build is no longer running',
            message: 'Only the latest live build of an app keeps its server running. Open the app URL for the current one.',
            dashboard: deployment.appUrl ?? `${dashboardUrl}/deployments/${id}`,
            ...(deployment.appUrl && { linkLabel: 'Open the live app' }),
          }),
        );
      }
      if (deployment.status === 'failed') {
        return html(
          res,
          502,
          statusPage({
            code: 'Build failed',
            title: 'This deployment failed to build',
            message: deployment.error ?? 'Check the build logs for details.',
            dashboard: `${dashboardUrl}/deployments/${id}`,
          }),
        );
      }
      return html(
        res,
        404,
        statusPage({
          code: '404 · Not found',
          title: 'Page not found',
          message: `"${url.pathname}" doesn't exist in this deployment.`,
          dashboard: `${dashboardUrl}/deployments`,
        }),
      );
    }

    const { key, obj } = found;
    if (obj.etag && req.headers['if-none-match'] === obj.etag) {
      obj.body.destroy();
      res.writeHead(304, { ETag: obj.etag }).end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': obj.contentType,
      'Content-Length': obj.size,
      'Cache-Control': cacheControl(key),
      ...(obj.etag ? { ETag: obj.etag } : {}),
      'X-Kiln-Id': id,
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      obj.body.destroy();
      res.end();
    } else {
      await pipeline(obj.body, res);
    }
  } catch (err) {
    console.error('[router]', err);
    if (!res.headersSent) html(res, 500, 'Internal router error');
    else res.destroy();
  } finally {
    const ms = (performance.now() - started).toFixed(1);
    console.log(`[router] ${res.statusCode} ${hostname}${req.url} ${ms}ms`);
  }
});

// WebSockets to server apps. Static builds have nothing to upgrade to.
server.on('upgrade', async (req, socket, head) => {
  try {
    const hostname = (req.headers.host ?? '').split(':')[0].toLowerCase();
    if (!hostname.endsWith(SUFFIX)) return void socket.destroy();
    const label = hostname.slice(0, -SUFFIX.length).split('.').pop()!;
    if (!ID_RE.test(label)) return void socket.destroy();
    const id = label.includes('-') ? await resolveAppSlug(redis, label) : label;
    if (!id) return void socket.destroy();
    const [paused, runtimeRaw] = await redis.mget(keys.paused(id), keys.runtime(id));
    const target = !paused && runtimeRaw ? upstream(JSON.parse(runtimeRaw) as RuntimeInfo) : null;
    if (!target) return void socket.destroy();
    proxyUpgrade(req, socket, head, target);
  } catch {
    socket.destroy();
  }
});

server.listen(config.routerPort, () => {
  console.log(`[router] serving *${SUFFIX}:${config.routerPort} from ${config.storage.driver} storage`);
});

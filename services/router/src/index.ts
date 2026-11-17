import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  ACTIVE_STATUSES,
  config,
  getDeployment,
  getStorage,
  storageKeys,
  type StoredObject,
} from '@deployx/shared';
import { statusPage } from './pages';

const storage = await getStorage();
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
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

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

    const id = hostname.slice(0, -SUFFIX.length).split('.').pop()!;
    if (!ID_RE.test(id)) return html(res, 400, 'Bad host');

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

server.listen(config.routerPort, () => {
  console.log(`[router] serving *${SUFFIX}:${config.routerPort} from ${config.storage.driver} storage`);
});

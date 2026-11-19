import { type NextFunction, type Request, type Response, Router } from 'express';
import { prisma, type Redis } from '@deployx/shared';
import { authConfig, dashboardUrl } from '../auth/config';
import { safeNext } from '../auth/routes';
import { randomUrlSafe } from '../auth/tokens';
import {
  GitHubError,
  exchangeUserCode,
  getGitHubUser,
  githubConfig,
  listInstallationRepos,
  userAuthorizeUrl,
  type GitHubRepo,
} from './app';

const STATE_COOKIE = 'kiln_gh_state';
const STATE_TTL_SECONDS = 600;

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const stateKey = (state: string) => `kiln:github:state:${state}`;

/**
 * Browser redirects back from GitHub. They can't carry the Bearer token, so they are public, but the
 * single-use `state` must match an httpOnly cookie set for *this browser* when it started the flow.
 */
export function githubPublicRouter(redis: Redis) {
  const r = Router();

  r.get(
    '/callback',
    wrap(async (req, res) => {
      const back = (path: string) => res.redirect(`${dashboardUrl}${path}`);
      res.clearCookie(STATE_COOKIE, { path: '/api/github' });
      if (typeof req.query.error === 'string') return back('/new?github=denied');

      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      if (!state || !code || state !== req.cookies?.[STATE_COOKIE]) return back('/new?github=expired');
      const saved = await redis.getdel(stateKey(state));
      if (!saved) return back('/new?github=expired');
      const { userId, next } = JSON.parse(saved) as { userId: string; next: string };

      try {
        const gh = await getGitHubUser(await exchangeUserCode(code));
        // Kiln isn't installed anywhere this user can see yet: send them to pick repos.
        if (gh.installationIds.length === 0) return res.redirect(githubConfig.installUrl);

        const data = {
          githubUserId: BigInt(gh.id),
          login: gh.login,
          avatarUrl: gh.avatarUrl,
          installationIds: gh.installationIds.map((id) => BigInt(id)),
        };
        await prisma.$transaction([
          // A GitHub account links to one Kiln user; proving control of it moves the link.
          prisma.gitHubConnection.deleteMany({ where: { githubUserId: data.githubUserId, NOT: { userId } } }),
          prisma.gitHubConnection.upsert({ where: { userId }, create: { userId, ...data }, update: data }),
        ]);
        back(`${next}${next.includes('?') ? '&' : '?'}github=connected`);
      } catch (err) {
        console.error('[github] connect failed:', (err as Error).message);
        back('/new?github=failed');
      }
    }),
  );

  /** GitHub's "Setup URL" after installing/updating the app: finish connecting from the console. */
  r.get('/setup', (_req, res) => res.redirect(`${dashboardUrl}/new?github=installed`));

  return r;
}

/** Signed-in routes (mounted after requireAuth). */
export function githubRouter(redis: Redis) {
  const r = Router();

  r.get(
    '/status',
    wrap(async (req, res) => {
      const conn = await prisma.gitHubConnection.findUnique({ where: { userId: req.auth!.userId } });
      res.json({
        configured: githubConfig.enabled,
        connected: Boolean(conn),
        login: conn?.login ?? null,
        avatarUrl: conn?.avatarUrl ?? null,
        installUrl: githubConfig.enabled ? githubConfig.installUrl : null,
        manageUrl: githubConfig.manageUrl,
      });
    }),
  );

  /** Start connecting: returns GitHub's authorize URL and binds the flow to this browser. */
  r.post(
    '/connect',
    wrap(async (req, res) => {
      if (!githubConfig.enabled) return res.status(503).json({ error: 'GitHub integration is not configured on this server.' });
      const state = randomUrlSafe(32);
      const next = safeNext(req.body?.next ?? '/new').split('?')[0];
      await redis.set(stateKey(state), JSON.stringify({ userId: req.auth!.userId, next }), 'EX', STATE_TTL_SECONDS);
      res.cookie(STATE_COOKIE, state, {
        httpOnly: true,
        secure: authConfig.cookieSecure,
        sameSite: 'lax', // sent on the top-level redirect back from github.com
        path: '/api/github',
        maxAge: STATE_TTL_SECONDS * 1000,
      });
      res.json({ url: userAuthorizeUrl(state) });
    }),
  );

  /** Repositories the user granted Kiln, across their installations, most recently pushed first. */
  r.get(
    '/repos',
    wrap(async (req, res) => {
      const conn = await prisma.gitHubConnection.findUnique({ where: { userId: req.auth!.userId } });
      if (!conn) return res.status(404).json({ error: 'GitHub is not connected', code: 'not_connected' });

      const repos: GitHubRepo[] = [];
      const stillInstalled: bigint[] = [];
      for (const id of conn.installationIds) {
        try {
          repos.push(...(await listInstallationRepos(id)));
          stillInstalled.push(id);
        } catch (err) {
          // Uninstalled or suspended on GitHub since connecting: forget it.
          if (!(err instanceof GitHubError && (err.status === 404 || err.status === 403))) throw err;
        }
      }
      if (stillInstalled.length !== conn.installationIds.length) {
        await prisma.gitHubConnection.update({ where: { id: conn.id }, data: { installationIds: stillInstalled } });
      }
      const seen = new Set<number>();
      const unique = repos.filter((r) => !seen.has(r.id) && seen.add(r.id));
      unique.sort((a, b) => Date.parse(b.pushedAt ?? '0') - Date.parse(a.pushedAt ?? '0'));
      res.json({ login: conn.login, repos: unique });
    }),
  );

  /** Unlink in Kiln. (Removing the app from GitHub itself is done in GitHub settings.) */
  r.delete(
    '/connection',
    wrap(async (req, res) => {
      await prisma.gitHubConnection.deleteMany({ where: { userId: req.auth!.userId } });
      res.status(204).end();
    }),
  );

  return r;
}

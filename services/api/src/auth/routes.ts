import { type NextFunction, type Request, type Response, Router } from 'express';
import { prisma, type Redis } from '@deployx/shared';
import { authConfig, dashboardUrl } from './config';
import { buildGoogleAuthUrl, exchangeGoogleCode, upsertGoogleUser } from './google';
import { rateLimit, requireAuth, requireCsrfHeader } from './middleware';
import { burnPasswordCheck, hashPassword, verifyPassword } from './passwords';
import {
  REFRESH_COOKIE,
  clearRefreshCookie,
  createSession,
  revokeByToken,
  rotateSession,
  setRefreshCookie,
} from './sessions';
import { signAccessToken } from './tokens';

const OAUTH_STATE_COOKIE = 'kiln_oauth_state';
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const publicUser = (u: { id: string; email: string; name: string; avatarUrl: string | null }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
});

/** Only same-app relative paths: blocks open redirects like `//evil.com` or `https://…`. */
export function safeNext(value: unknown) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
    ? value
    : '/deployments';
}

/** Issue an access token for the response body and set a fresh refresh-token cookie. */
async function signIn(res: Response, req: Request, user: { id: string; email: string; name: string; avatarUrl: string | null }) {
  setRefreshCookie(res, await createSession(user.id, req));
  const access = await signAccessToken(user);
  return { accessToken: access.token, expiresIn: access.expiresIn, user: publicUser(user) };
}

export function authRouter(redis: Redis) {
  const r = Router();
  const byIp = (req: Request) => req.ip ?? 'unknown';
  const byEmail = (req: Request) => String(req.body?.email ?? '').toLowerCase().slice(0, 320);

  r.get('/providers', (_req, res) => res.json({ password: true, google: authConfig.google.enabled }));

  r.post(
    '/register',
    rateLimit(redis, 'register', 10, 60 * 60, byIp),
    wrap(async (req, res) => {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      const name = String(req.body?.name ?? '').trim();
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address', field: 'email' });
      if (name.length < 1 || name.length > 80) return res.status(400).json({ error: 'Enter your name', field: 'name' });
      if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters', field: 'password' });
      if (password.length > 128) return res.status(400).json({ error: 'Use at most 128 characters', field: 'password' });

      if (await prisma.user.findUnique({ where: { email } })) {
        return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.', field: 'email' });
      }
      const user = await prisma.user.create({ data: { email, name, passwordHash: await hashPassword(password) } });
      res.status(201).json(await signIn(res, req, user));
    }),
  );

  r.post(
    '/login',
    rateLimit(redis, 'login-ip', 30, 15 * 60, byIp),
    rateLimit(redis, 'login-email', 10, 15 * 60, byEmail),
    wrap(async (req, res) => {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      const user = email ? await prisma.user.findUnique({ where: { email } }) : null;
      if (!user?.passwordHash) {
        await burnPasswordCheck(password); // same timing whether or not the account exists
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      if (!(await verifyPassword(user.passwordHash, password))) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      res.json(await signIn(res, req, user));
    }),
  );

  /** Rotate the refresh cookie and return a new access token. Called on page load and before expiry. */
  r.post(
    '/refresh',
    requireCsrfHeader,
    wrap(async (req, res) => {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (!token) return res.status(401).json({ error: 'Not signed in', code: 'no_session' });
      const result = await rotateSession(token, req);
      if (!result.ok) {
        // A concurrent refresh already rotated it: keep the (newer) cookie and let the client retry.
        if (result.reason !== 'stale') clearRefreshCookie(res);
        return res.status(401).json({ error: 'Session ended. Sign in again.', code: `session_${result.reason}` });
      }
      setRefreshCookie(res, result.token);
      const access = await signAccessToken(result.user);
      res.json({ accessToken: access.token, expiresIn: access.expiresIn, user: publicUser(result.user) });
    }),
  );

  r.post(
    '/logout',
    requireCsrfHeader,
    wrap(async (req, res) => {
      const token = req.cookies?.[REFRESH_COOKIE];
      if (token) await revokeByToken(token);
      clearRefreshCookie(res);
      res.status(204).end();
    }),
  );

  r.get(
    '/me',
    requireAuth,
    wrap(async (req, res) => {
      const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
      if (!user) return res.status(401).json({ error: 'Account no longer exists', code: 'unauthenticated' });
      res.json(publicUser(user));
    }),
  );

  // ── Google OAuth (Authorization Code + PKCE) ──────────────────────────────────

  r.get(
    '/google',
    wrap(async (req, res) => {
      if (!authConfig.google.enabled) return res.redirect(`${dashboardUrl}/login?error=google_unavailable`);
      const { url, state, verifier } = buildGoogleAuthUrl();
      await redis.set(`kiln:oauth:${state}`, JSON.stringify({ verifier, next: safeNext(req.query.next) }), 'EX', 600);
      res.cookie(OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: authConfig.cookieSecure,
        sameSite: 'lax', // must survive the top-level redirect back from accounts.google.com
        path: '/api/auth/google',
        maxAge: 10 * 60 * 1000,
      });
      res.redirect(url);
    }),
  );

  r.get(
    '/google/callback',
    wrap(async (req, res) => {
      const fail = (code: string) => res.redirect(`${dashboardUrl}/login?error=${code}`);
      res.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/auth/google' });
      if (typeof req.query.error === 'string') return fail('google_denied');

      const state = typeof req.query.state === 'string' ? req.query.state : '';
      const code = typeof req.query.code === 'string' ? req.query.code : '';
      // The state must match the cookie set when this browser started the flow (login-CSRF protection).
      if (!state || !code || state !== req.cookies?.[OAUTH_STATE_COOKIE]) return fail('google_state');
      const saved = await redis.getdel(`kiln:oauth:${state}`); // single use
      if (!saved) return fail('google_state');
      const { verifier, next } = JSON.parse(saved) as { verifier: string; next: string };

      try {
        const profile = await exchangeGoogleCode(code, verifier);
        const user = await upsertGoogleUser(profile);
        setRefreshCookie(res, await createSession(user.id, req));
        // No tokens in the URL: the console exchanges the httpOnly cookie for an access token.
        res.redirect(`${dashboardUrl}/auth/callback?next=${encodeURIComponent(next)}`);
      } catch (err) {
        console.error('[auth] Google sign-in failed:', (err as Error).message);
        fail('google_failed');
      }
    }),
  );

  return r;
}

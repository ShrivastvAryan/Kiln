import type { NextFunction, Request, Response } from 'express';
import type { Redis } from '@deployx/shared';
import { type AccessClaims, verifyAccessToken } from './tokens';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AccessClaims;
  }
}

/**
 * Requires a valid access token. Normal requests send `Authorization: Bearer <token>`.
 * EventSource (SSE) can't set headers, so GET stream endpoints may pass `?access_token=` instead.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const queryToken = req.method === 'GET' && typeof req.query.access_token === 'string' ? req.query.access_token : undefined;
  const token = bearer ?? queryToken;
  if (!token) return res.status(401).json({ error: 'Sign in required', code: 'unauthenticated' });

  const result = await verifyAccessToken(token);
  if (!result.ok) {
    return res
      .status(401)
      .json({ error: result.reason === 'expired' ? 'Session expired' : 'Invalid token', code: `token_${result.reason}` });
  }
  req.auth = result.claims;
  next();
}

/** Cookie-authenticated endpoints must come from our own JS (a custom header forces a CORS preflight). */
export function requireCsrfHeader(req: Request, res: Response, next: NextFunction) {
  if (req.get('x-requested-with') !== 'kiln') return res.status(403).json({ error: 'Missing X-Requested-With header' });
  next();
}

/** Fixed-window rate limit in Redis, keyed by whatever identifies the caller. */
export function rateLimit(redis: Redis, name: string, limit: number, windowSeconds: number, keyOf: (req: Request) => string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `kiln:ratelimit:${name}:${keyOf(req)}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, windowSeconds);
    if (count > limit) {
      const ttl = await redis.ttl(key);
      res.setHeader('Retry-After', String(Math.max(ttl, 1)));
      return res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(Math.max(ttl, 1) / 60)} min.` });
    }
    next();
  };
}

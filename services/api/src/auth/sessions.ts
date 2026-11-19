import type { Request, Response } from 'express';
import { prisma } from '@deployx/shared';
import { authConfig } from './config';
import { hashToken, newRefreshToken, randomUrlSafe } from './tokens';

export const REFRESH_COOKIE = 'kiln_rt';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Two tabs refreshing at the same moment both present the same token; tolerate that briefly. */
const CONCURRENT_REFRESH_GRACE_MS = 15_000;

const meta = (req: Request) => ({
  userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
  ip: req.ip ?? null,
});

/** Start a new sign-in (a new token family) and return the raw refresh token. */
export async function createSession(userId: string, req: Request) {
  const token = newRefreshToken();
  await prisma.session.create({
    data: {
      userId,
      familyId: randomUrlSafe(16),
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + authConfig.refreshTokenTtlDays * DAY_MS),
      ...meta(req),
    },
  });
  return token;
}

export type RotateResult =
  | { ok: true; token: string; user: { id: string; email: string; name: string; avatarUrl: string | null } }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' | 'stale' };

/**
 * Exchange a refresh token for a new one (rotation). Presenting a token that was already rotated
 * means it leaked or was replayed: every session in that family is revoked.
 */
export async function rotateSession(rawToken: string, req: Request): Promise<RotateResult> {
  const now = new Date();
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(rawToken) }, include: { user: true } });
  if (!session || session.revokedAt) return { ok: false, reason: 'invalid' };
  if (session.expiresAt <= now) return { ok: false, reason: 'expired' };

  if (session.rotatedAt) {
    if (now.getTime() - session.rotatedAt.getTime() < CONCURRENT_REFRESH_GRACE_MS) return { ok: false, reason: 'stale' };
    await revokeFamily(session.familyId);
    return { ok: false, reason: 'reused' };
  }

  // Conditional update so two simultaneous requests can't both rotate the same token.
  const { count } = await prisma.session.updateMany({
    where: { id: session.id, rotatedAt: null, revokedAt: null },
    data: { rotatedAt: now },
  });
  if (count === 0) return { ok: false, reason: 'stale' };

  const token = newRefreshToken();
  await prisma.session.create({
    data: {
      userId: session.userId,
      familyId: session.familyId,
      tokenHash: hashToken(token),
      expiresAt: new Date(now.getTime() + authConfig.refreshTokenTtlDays * DAY_MS),
      ...meta(req),
    },
  });
  const { id, email, name, avatarUrl } = session.user;
  return { ok: true, token, user: { id, email, name, avatarUrl } };
}

export async function revokeFamily(familyId: string) {
  await prisma.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Sign out: revoke the whole sign-in (all rotations of this token). */
export async function revokeByToken(rawToken: string) {
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (session) await revokeFamily(session.familyId);
}

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true, // never readable by JavaScript
    secure: authConfig.cookieSecure,
    sameSite: 'strict', // console and API are same-site; cross-site requests never carry it
    path: '/api/auth', // only sent to the auth endpoints
    maxAge: authConfig.refreshTokenTtlDays * DAY_MS,
  });
}

export function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: authConfig.cookieSecure, sameSite: 'strict', path: '/api/auth' });
}

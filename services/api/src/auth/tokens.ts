import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, errors, jwtVerify } from 'jose';
import { authConfig } from './config';

export interface AccessClaims {
  userId: string;
  email: string;
}

/** Short-lived (15 min) access token, kept only in browser memory and sent as a Bearer header. */
export async function signAccessToken(user: { id: string; email: string }) {
  const token = await new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(authConfig.issuer)
    .setAudience(authConfig.audience)
    .setIssuedAt()
    .setExpirationTime(`${authConfig.accessTokenTtlSeconds}s`)
    .sign(authConfig.accessSecret);
  return { token, expiresIn: authConfig.accessTokenTtlSeconds };
}

export type VerifyResult = { ok: true; claims: AccessClaims } | { ok: false; reason: 'expired' | 'invalid' };

export async function verifyAccessToken(token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, authConfig.accessSecret, {
      issuer: authConfig.issuer,
      audience: authConfig.audience,
      algorithms: ['HS256'], // never accept `none` or an algorithm the attacker chooses
    });
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return { ok: false, reason: 'invalid' };
    return { ok: true, claims: { userId: payload.sub, email: payload.email } };
  } catch (err) {
    return { ok: false, reason: err instanceof errors.JWTExpired ? 'expired' : 'invalid' };
  }
}

/** Opaque refresh token: 256 random bits. Only its SHA-256 hash is stored. */
export function newRefreshToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export const randomUrlSafe = (bytes = 32) => randomBytes(bytes).toString('base64url');

export const sha256Base64Url = (value: string) => createHash('sha256').update(value).digest('base64url');

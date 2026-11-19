import { createRemoteJWKSet, jwtVerify } from 'jose';
import { prisma } from '@deployx/shared';
import { authConfig } from './config';
import { randomUrlSafe, sha256Base64Url } from './tokens';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Authorization Code + PKCE: returns the consent URL plus the secrets to keep server-side. */
export function buildGoogleAuthUrl() {
  const state = randomUrlSafe(32); // binds the callback to this browser (stored in an httpOnly cookie)
  const verifier = randomUrlSafe(48); // PKCE: proves the token request comes from whoever started the flow
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: authConfig.google.clientId,
    redirect_uri: authConfig.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: sha256Base64Url(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return { url: url.toString(), state, verifier };
}

interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

/** Exchange the code, then verify the ID token's signature, issuer, audience and expiry. */
export async function exchangeGoogleCode(code: string, verifier: string): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: authConfig.google.clientId,
      client_secret: authConfig.google.clientSecret,
      redirect_uri: authConfig.google.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status})`);
  const { id_token: idToken } = (await res.json()) as { id_token?: string };
  if (!idToken) throw new Error('Google did not return an ID token');

  const { payload } = await jwtVerify(idToken, googleKeys, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: authConfig.google.clientId,
  });
  if (payload.email_verified !== true || typeof payload.email !== 'string' || typeof payload.sub !== 'string') {
    throw new Error('Google account email is not verified');
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: typeof payload.name === 'string' ? payload.name : payload.email.split('@')[0],
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  };
}

/**
 * Find or create the Kiln user for a Google identity.
 * Linking to an existing email account is safe only because Google verified the address; if that
 * account was created with a password nobody ever verified, the password is removed so whoever
 * pre-registered the address can't keep access (pre-account-takeover protection).
 */
export async function upsertGoogleUser(profile: GoogleProfile) {
  const linked = await prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider: 'google', providerAccountId: profile.sub } },
    include: { user: true },
  });
  if (linked) return linked.user;

  const existing = await prisma.user.findUnique({ where: { email: profile.email } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: {
        emailVerified: true,
        avatarUrl: existing.avatarUrl ?? profile.picture,
        ...(existing.emailVerified ? {} : { passwordHash: null }),
        accounts: { create: { provider: 'google', providerAccountId: profile.sub } },
      },
    });
  }

  return prisma.user.create({
    data: {
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
      emailVerified: true,
      accounts: { create: { provider: 'google', providerAccountId: profile.sub } },
    },
  });
}

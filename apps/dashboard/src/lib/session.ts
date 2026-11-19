import { API_URL, ApiError, UNREACHABLE } from './http';

/*
 * Client-side auth session.
 * - The access token (15 min JWT) lives only in this module's memory: never localStorage, so an
 *   XSS bug can't read a long-lived credential from storage.
 * - The refresh token is an httpOnly cookie the browser sends to /api/auth/refresh; JS never sees it.
 * - A refresh is scheduled shortly before expiry, and concurrent refreshes share one request.
 */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

export interface SessionState {
  status: 'loading' | 'authenticated' | 'unauthenticated';
  user: SessionUser | null;
  token: string | null;
}

interface TokenResponse {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}

let state: SessionState = { status: 'loading', user: null, token: null };
const listeners = new Set<() => void>();
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let inflight: Promise<boolean> | null = null;

function update(next: Partial<SessionState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function accept(data: TokenResponse) {
  update({ status: 'authenticated', token: data.accessToken, user: data.user });
  clearTimeout(refreshTimer);
  // Refresh a minute before expiry so requests never carry an expired token.
  refreshTimer = setTimeout(() => void refreshSession(), Math.max(10, data.expiresIn - 60) * 1000);
}

function signedOut() {
  clearTimeout(refreshTimer);
  update({ status: 'unauthenticated', token: null, user: null });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function doRefresh(attempt = 0): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Requested-With': 'kiln' },
    });
  } catch {
    if (state.status === 'loading') signedOut();
    return false;
  }
  if (res.ok) {
    accept((await res.json()) as TokenResponse);
    return true;
  }
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  // Another tab rotated the cookie a moment ago; the browser now holds the newer one, so retry.
  if (body.code === 'session_stale' && attempt < 2) {
    await sleep(300 * (attempt + 1));
    return doRefresh(attempt + 1);
  }
  signedOut();
  return false;
}

/** Exchange the refresh cookie for a new access token. Returns false when the user isn't signed in. */
export function refreshSession() {
  inflight ??= doRefresh().finally(() => (inflight = null));
  return inflight;
}

async function authPost(path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${API_URL}/api/auth/${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kiln' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(UNREACHABLE, 0);
  }
}

async function signInWith(path: 'login' | 'register', body: Record<string, string>) {
  const res = await authPost(path, body);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong', res.status, data.field);
  accept(data as TokenResponse);
  return (data as TokenResponse).user;
}

export const signIn = (email: string, password: string) => signInWith('login', { email, password });

export const signUp = (name: string, email: string, password: string) =>
  signInWith('register', { name, email, password });

export async function signOut() {
  await authPost('logout').catch(() => undefined);
  signedOut();
}

/** Full-page navigation: Google's consent screen, then back to /auth/callback. */
export const googleSignInUrl = (next: string) => `${API_URL}/api/auth/google?next=${encodeURIComponent(next)}`;

export async function fetchProviders(): Promise<{ password: boolean; google: boolean }> {
  try {
    const res = await fetch(`${API_URL}/api/auth/providers`);
    if (res.ok) return await res.json();
  } catch {
    /* fall through */
  }
  return { password: true, google: false };
}

export const getAccessToken = () => state.token;

export const sessionStore = {
  get: () => state,
  serverSnapshot: { status: 'loading', user: null, token: null } as SessionState,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Only same-app relative paths are allowed as post-login destinations (no open redirects). */
export function safeNext(value: string | null | undefined, fallback = '/deployments') {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : fallback;
}

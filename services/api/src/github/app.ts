import { createPrivateKey, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import { SignJWT } from 'jose';
import { authConfig } from '../auth/config';

/*
 * GitHub App client.
 * - App JWT (RS256, ~9 min) signed with the app's private key authenticates Kiln *as the app*.
 * - Installation tokens (1 h) are minted from it per installation and cached until near expiry.
 * - User sign-in (OAuth web flow of the GitHub App) proves which GitHub user is connecting and
 *   which installations they can access. The user token is used once and never stored.
 */

const env = (key: string) => (process.env[key] ?? '').trim();
const API = 'https://api.github.com';

function loadPrivateKey(): KeyObject | null {
  const path = env('GITHUB_APP_PRIVATE_KEY_PATH');
  let pem = path && fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : env('GITHUB_APP_PRIVATE_KEY');
  if (!pem) return null;
  if (!pem.includes('-----BEGIN')) pem = Buffer.from(pem, 'base64').toString('utf8'); // base64-encoded PEM
  pem = pem.replace(/\\n/g, '\n'); // PEM pasted on one line with literal \n
  try {
    // GitHub issues PKCS#1 ("BEGIN RSA PRIVATE KEY"); Node's KeyObject accepts both PKCS#1 and PKCS#8.
    return createPrivateKey(pem);
  } catch {
    // A bad key must only disable GitHub, never take down sign-in and deployments.
    console.error(
      '[github] GITHUB_APP_PRIVATE_KEY is not a valid private key, so GitHub integration is disabled. ' +
        'Use the downloaded .pem (not the SHA256 fingerprint), base64-encoded: base64 -w0 <file>.pem',
    );
    return null;
  }
}

export const githubConfig = {
  appId: env('GITHUB_APP_ID'),
  slug: env('GITHUB_APP_SLUG'),
  clientId: env('GITHUB_APP_CLIENT_ID'),
  clientSecret: env('GITHUB_APP_CLIENT_SECRET'),
  privateKey: loadPrivateKey(),
  callbackUrl: `${authConfig.apiPublicUrl}/api/github/callback`,
  get enabled() {
    return Boolean(this.appId && this.slug && this.clientId && this.clientSecret && this.privateKey);
  },
  get installUrl() {
    return `https://github.com/apps/${this.slug}/installations/new`;
  },
  manageUrl: 'https://github.com/settings/installations',
};

export class GitHubError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function gh<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kiln-deploy',
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!res.ok) throw new GitHubError(`GitHub ${init.method ?? 'GET'} ${path} → ${res.status}`, res.status);
  return (await res.json()) as T;
}

// ── App + installation auth ────────────────────────────────────────────────────

let appJwt: { token: string; expiresAt: number } | null = null;

/** JWT identifying Kiln as the GitHub App (max 10 min per GitHub; we use 9 and backdate 60 s for clock skew). */
export async function getAppJwt() {
  if (appJwt && appJwt.expiresAt - Date.now() > 60_000) return appJwt.token;
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(githubConfig.appId)
    .setIssuedAt(now - 60)
    .setExpirationTime(now + 9 * 60)
    .sign(githubConfig.privateKey!);
  appJwt = { token, expiresAt: (now + 9 * 60) * 1000 };
  return token;
}

const installationTokens = new Map<string, { token: string; expiresAt: number }>();

/** 1-hour token scoped to one installation (only the repos the user granted, read-only). */
export async function getInstallationToken(installationId: bigint | string) {
  const key = String(installationId);
  const cached = installationTokens.get(key);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  const data = await gh<{ token: string; expires_at: string }>(
    `/app/installations/${key}/access_tokens`,
    await getAppJwt(),
    { method: 'POST' },
  );
  installationTokens.set(key, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

// ── User sign-in (which GitHub user is connecting) ─────────────────────────────

export function userAuthorizeUrl(state: string) {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({
    client_id: githubConfig.clientId,
    redirect_uri: githubConfig.callbackUrl,
    state,
    allow_signup: 'false',
  }).toString();
  return url.toString();
}

export async function exchangeUserCode(code: string) {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: githubConfig.clientId,
      client_secret: githubConfig.clientSecret,
      code,
      redirect_uri: githubConfig.callbackUrl,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!data.access_token) throw new GitHubError(`GitHub code exchange failed: ${data.error ?? res.status}`, 400);
  return data.access_token;
}

export async function getGitHubUser(userToken: string) {
  const user = await gh<{ id: number; login: string; avatar_url: string }>('/user', userToken);
  // Installations of *this* app that this user can access (their own account, or orgs they belong to).
  const { installations } = await gh<{ installations: { id: number }[] }>('/user/installations?per_page=100', userToken);
  return { id: user.id, login: user.login, avatarUrl: user.avatar_url, installationIds: installations.map((i) => i.id) };
}

// ── Repositories ───────────────────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;
  description: string | null;
  language: string | null;
  pushedAt: string | null;
}

interface RawRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  html_url: string;
  clone_url: string;
  description: string | null;
  language: string | null;
  pushed_at: string | null;
}

/** Repos one installation can see (exactly what the user selected on GitHub). */
export async function listInstallationRepos(installationId: bigint | string): Promise<GitHubRepo[]> {
  const token = await getInstallationToken(installationId);
  const repos: GitHubRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = await gh<{ total_count: number; repositories: RawRepo[] }>(
      `/installation/repositories?per_page=100&page=${page}`,
      token,
    );
    for (const r of data.repositories) {
      repos.push({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner.login,
        private: r.private,
        defaultBranch: r.default_branch,
        htmlUrl: r.html_url,
        cloneUrl: r.clone_url,
        description: r.description,
        language: r.language,
        pushedAt: r.pushed_at,
      });
    }
    if (repos.length >= data.total_count || data.repositories.length === 0) break;
  }
  return repos;
}

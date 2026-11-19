/** Auth settings, read once at startup. Secrets come from the environment (.env → docker-compose). */

const env = (key: string, fallback = '') => (process.env[key] ?? '').trim() || fallback;

const accessSecret = env('JWT_ACCESS_SECRET');
if (accessSecret.length < 32) {
  throw new Error('JWT_ACCESS_SECRET must be set to at least 32 random characters (openssl rand -base64 48).');
}

const apiPublicUrl = env('API_PUBLIC_URL', 'http://localhost:8000').replace(/\/$/, '');

export const authConfig = {
  accessSecret: new TextEncoder().encode(accessSecret),
  accessTokenTtlSeconds: 15 * 60,
  refreshTokenTtlDays: 30,
  issuer: 'kiln',
  audience: 'kiln-api',
  apiPublicUrl,
  /** Console origins allowed to call the API with credentials (comma-separated). */
  dashboardOrigins: env('DASHBOARD_URL', 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean),
  /** Secure cookies need HTTPS; default to on whenever the API is served over https. */
  cookieSecure: env('COOKIE_SECURE', apiPublicUrl.startsWith('https://') ? 'true' : 'false') === 'true',
  google: {
    clientId: env('GOOGLE_CLIENT_ID'),
    clientSecret: env('GOOGLE_CLIENT_SECRET'),
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
    redirectUri: `${apiPublicUrl}/api/auth/google/callback`,
  },
};

export const dashboardUrl = authConfig.dashboardOrigins[0];

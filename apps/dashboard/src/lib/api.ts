import type {
  CreateDeploymentInput,
  Deployment,
  LogLine,
  PlatformStats,
} from '@deployx/shared/types';

import { API_URL, ApiError, UNREACHABLE } from './http';
import { getAccessToken, refreshSession } from './session';

export { API_URL, ApiError };

export interface GitHubStatus {
  configured: boolean;
  connected: boolean;
  login: string | null;
  avatarUrl: string | null;
  installUrl: string | null;
  manageUrl: string;
}

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

async function send(path: string, init?: RequestInit) {
  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (init?.body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    return await fetch(API_URL + path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } });
  } catch {
    throw new ApiError(UNREACHABLE, 0);
  }
}

/** Authenticated request: on 401 it refreshes the access token once and retries. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res = await send(path, init);
  if (res.status === 401 && (await refreshSession())) res = await send(path, init);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status, data.field, data.code);
  return data as T;
}

export const api = {
  listDeployments: () => request<Deployment[]>('/api/deployments'),
  getDeployment: (id: string) => request<Deployment>(`/api/deployments/${id}`),
  createDeployment: (input: CreateDeploymentInput) =>
    request<Deployment>('/api/deployments', { method: 'POST', body: JSON.stringify(input) }),
  redeploy: (id: string) => request<Deployment>(`/api/deployments/${id}/redeploy`, { method: 'POST' }),
  deleteDeployment: (id: string) => request<void>(`/api/deployments/${id}`, { method: 'DELETE' }),
  cancelDeployment: (id: string) => request<Deployment>(`/api/deployments/${id}/cancel`, { method: 'POST' }),
  pauseDeployment: (id: string) => request<Deployment>(`/api/deployments/${id}/pause`, { method: 'POST' }),
  resumeDeployment: (id: string) => request<Deployment>(`/api/deployments/${id}/resume`, { method: 'POST' }),
  logs: (id: string) => request<LogLine[]>(`/api/deployments/${id}/logs`),
  stats: () => request<PlatformStats>('/api/stats'),

  githubStatus: () => request<GitHubStatus>('/api/github/status'),
  githubRepos: () => request<{ login: string; repos: GitHubRepo[] }>('/api/github/repos'),
  githubDisconnect: () => request<void>('/api/github/connection', { method: 'DELETE' }),
  /** Starts the GitHub flow; `credentials` lets the API set the browser-binding state cookie. */
  githubConnect: (next = '/new') =>
    request<{ url: string }>('/api/github/connect', {
      method: 'POST',
      body: JSON.stringify({ next }),
      credentials: 'include',
    }),
};

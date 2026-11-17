import type {
  CreateDeploymentInput,
  Deployment,
  LogLine,
  PlatformStats,
  SystemHealth,
} from '@deployx/shared/types';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public field?: string,
  ) {
    super(message);
  }
}

/** The browser talks to the API directly (CORS enabled), including the SSE streams. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the Kiln API. Is it running on port 8000?', 0);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? res.statusText, res.status, data.field);
  return data as T;
}

export const api = {
  listDeployments: () => request<Deployment[]>('/api/deployments'),
  getDeployment: (id: string) => request<Deployment>(`/api/deployments/${id}`),
  createDeployment: (input: CreateDeploymentInput) =>
    request<Deployment>('/api/deployments', { method: 'POST', body: JSON.stringify(input) }),
  redeploy: (id: string) => request<Deployment>(`/api/deployments/${id}/redeploy`, { method: 'POST' }),
  deleteDeployment: (id: string) => request<void>(`/api/deployments/${id}`, { method: 'DELETE' }),
  logs: (id: string) => request<LogLine[]>(`/api/deployments/${id}/logs`),
  stats: () => request<PlatformStats>('/api/stats'),
  health: () => request<SystemHealth>('/api/health'),
};

'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type GitHubStatus } from '@/lib/api';

/** The signed-in user's GitHub connection (null while loading or if the API is unreachable). */
export function useGitHubStatus() {
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    try {
      setStatus(await api.githubStatus());
    } catch {
      setStatus(null);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { status, loaded, reload };
}

/** Full-page hop to GitHub (authorize, and install the app if needed), then back to `next`. */
export async function startGitHubConnect(next = '/new') {
  const { url } = await api.githubConnect(next);
  window.location.assign(url);
}

export type GitHubStatusState = ReturnType<typeof useGitHubStatus>;

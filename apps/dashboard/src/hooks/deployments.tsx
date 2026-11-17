'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Deployment, PlatformEvent } from '@deployx/shared/types';
import { API_URL, api } from '@/lib/api';

interface DeploymentsState {
  deployments: Deployment[];
  byId: Map<string, Deployment>;
  loading: boolean;
  error: string | null;
  /** Whether the realtime event stream is connected. */
  live: boolean;
  upsert: (d: Deployment) => void;
  remove: (id: string) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<DeploymentsState | null>(null);

/**
 * Single source of truth for deployments: loads the list once, then keeps it in sync
 * through the server-sent event stream (/api/events) — no polling.
 */
export function DeploymentsProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Map<string, Deployment>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const upsert = useCallback((d: Deployment) => {
    setMap((prev) => {
      const current = prev.get(d.id);
      if (current && current.updatedAt > d.updatedAt) return prev; // ignore stale updates
      const next = new Map(prev);
      next.set(d.id, d);
      return next;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setMap((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listDeployments();
      setMap(new Map(list.map((d) => [d.id, d])));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const es = new EventSource(`${API_URL}/api/events`);
    es.onopen = () => {
      setLive(true);
      void refresh(); // resync anything missed while disconnected
    };
    es.onerror = () => setLive(false);
    es.addEventListener('event', (e) => {
      const event = JSON.parse((e as MessageEvent).data) as PlatformEvent;
      if (event.type === 'deployment.updated') upsert(event.deployment);
      else if (event.type === 'deployment.deleted') remove(event.id);
    });
    return () => es.close();
  }, [refresh, upsert, remove]);

  const value = useMemo<DeploymentsState>(() => {
    const deployments = [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
    return { deployments, byId: map, loading, error, live, upsert, remove, refresh };
  }, [map, loading, error, live, upsert, remove, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDeployments() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useDeployments must be used inside DeploymentsProvider');
  return ctx;
}

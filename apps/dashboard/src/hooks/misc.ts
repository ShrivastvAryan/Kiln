'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SystemHealth } from '@deployx/shared/types';
import { api } from '@/lib/api';

/** Re-renders every `interval` ms; used for live "elapsed" timers and relative times. */
export function useNow(interval = 1000, enabled = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval, enabled]);
  return now;
}

export function useHealth(interval = 5000) {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [reachable, setReachable] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .health()
        .then((h) => {
          if (cancelled) return;
          setHealth(h);
          setReachable(true);
        })
        .catch(() => !cancelled && setReachable(false));
    void load();
    const t = setInterval(load, interval);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [interval]);
  return { health, reachable };
}

/** Global single-key shortcuts, ignored while typing in inputs. */
export function useHotkey(key: string, handler: (e: KeyboardEvent) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === key.toLowerCase()) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [key, handler]);
}

type Theme = 'dark' | 'light';

export function useTheme() {
  // Server render assumes dark; the inline script in layout.tsx has already applied the saved theme.
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => {
    setTheme((document.documentElement.dataset.theme as Theme | undefined) ?? 'dark');
  }, []);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try {
        localStorage.setItem('deployx-theme', next);
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);
  return { theme, toggle };
}

export function useCopy(timeout = 1500) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), timeout);
      } catch {
        /* clipboard blocked */
      }
    },
    [timeout],
  );
  return { copied, copy };
}

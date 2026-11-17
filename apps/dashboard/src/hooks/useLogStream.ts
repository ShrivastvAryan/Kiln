'use client';

import { useEffect, useRef, useState } from 'react';
import type { LogLine } from '@deployx/shared/types';
import { API_URL } from '@/lib/api';

/**
 * Streams build logs over SSE. The server replays history first, then pushes live lines;
 * lines are de-duplicated by sequence number and flushed to React at most once per frame,
 * so thousands of lines per second don't cause thousands of renders.
 */
export function useLogStream(id: string) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const buffer = useRef<LogLine[]>([]);
  const seen = useRef(new Set<number>());
  const frame = useRef<number | null>(null);

  useEffect(() => {
    setLines([]);
    setLoaded(false);
    buffer.current = [];
    seen.current = new Set();

    const flush = () => {
      frame.current = null;
      if (!buffer.current.length) return;
      const batch = buffer.current;
      buffer.current = [];
      setLines((prev) => {
        const merged = prev.concat(batch);
        // Lines can occasionally arrive out of order across history/live; keep them sorted.
        for (let i = Math.max(1, prev.length); i < merged.length; i++) {
          if (merged[i].n < merged[i - 1].n) return merged.sort((a, b) => a.n - b.n);
        }
        return merged;
      });
    };
    const schedule = () => {
      if (frame.current == null) frame.current = requestAnimationFrame(flush);
    };

    const es = new EventSource(`${API_URL}/api/deployments/${id}/logs/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener('history', (e) => {
      const history = JSON.parse((e as MessageEvent).data) as LogLine[];
      const fresh = history.filter((l) => !seen.current.has(l.n));
      if (fresh.length) {
        for (const l of fresh) seen.current.add(l.n);
        buffer.current.push(...fresh);
        schedule();
      }
      setLoaded(true);
    });

    es.addEventListener('log', (e) => {
      const line = JSON.parse((e as MessageEvent).data) as LogLine;
      if (seen.current.has(line.n)) return;
      seen.current.add(line.n);
      buffer.current.push(line);
      schedule();
    });

    return () => {
      es.close();
      if (frame.current != null) cancelAnimationFrame(frame.current);
    };
  }, [id]);

  return { lines, connected, loaded };
}

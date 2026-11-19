'use client';

import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { refreshSession, sessionStore } from '@/lib/session';

/** Restores the session on load by exchanging the httpOnly refresh cookie for an access token. */
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void refreshSession();
  }, []);
  return children;
}

export function useSession() {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => sessionStore.serverSnapshot);
}

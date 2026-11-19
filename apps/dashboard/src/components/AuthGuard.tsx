'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useSession } from '@/hooks/auth';

/**
 * Console pages render only for a signed-in user; otherwise redirect to /login?next=….
 * This is a UX guard: the real protection is the API, which rejects every request without a valid token.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [status, pathname, router]);

  if (status !== 'authenticated') {
    return (
      <div className="grid min-h-screen place-items-center" role="status" aria-live="polite">
        <span className="flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> {status === 'loading' ? 'Loading your workspace…' : 'Redirecting to sign in…'}
        </span>
      </div>
    );
  }
  return children;
}

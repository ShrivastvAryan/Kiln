'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { refreshSession, safeNext } from '@/lib/session';

/** Landing page after Google: the API set the refresh cookie; exchange it for an access token. */
function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const next = safeNext(params.get('next'));
    void refreshSession().then((ok) => router.replace(ok ? next : '/login?error=google_failed'));
  }, [params, router]);
  return (
    <p className="flex items-center gap-2 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" /> Signing you in…
    </p>
  );
}

export default function CallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}

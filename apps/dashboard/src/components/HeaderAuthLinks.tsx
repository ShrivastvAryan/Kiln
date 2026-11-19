'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useSession } from '@/hooks/auth';
import { Avatar } from './UserMenu';

/** Home page header actions: sign in / get started for visitors, the console for signed-in users. */
export function HeaderAuthLinks() {
  const { status, user } = useSession();
  const primary =
    'inline-flex h-9 items-center gap-1.5 rounded-lg bg-fg px-4 font-medium text-bg transition-opacity hover:opacity-90';

  if (status === 'authenticated' && user) {
    return (
      <>
        <Avatar name={user.name} src={user.avatarUrl} className="hidden size-8 sm:grid" />
        <Link href="/deployments" className={primary}>
          Open console <ArrowRight className="size-4" />
        </Link>
      </>
    );
  }
  return (
    <>
      <Link href="/login" className="rounded-md px-3 py-2 text-muted hover:text-fg">
        Sign in
      </Link>
      <Link href="/register" className={primary}>
        Get started <ArrowRight className="size-4" />
      </Link>
    </>
  );
}

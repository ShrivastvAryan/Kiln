'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useSession } from '@/hooks/auth';
import { signOut } from '@/lib/session';

export function Avatar({ name, src, className = 'size-8' }: { name: string; src?: string | null; className?: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" referrerPolicy="no-referrer" className={`${className} shrink-0 rounded-full object-cover`} />
  ) : (
    <span className={`${className} grid shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent`}>
      {initials || '?'}
    </span>
  );
}

/** Signed-in account + sign-out, shown at the bottom of the console sidebar. */
export function UserMenu() {
  const { user } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-bg/50 p-2.5">
      <Avatar name={user.name} src={user.avatarUrl} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{user.name}</p>
        <p className="truncate text-xs text-subtle">{user.email}</p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await signOut();
          router.replace('/login');
        }}
        aria-label="Sign out"
        title="Sign out"
        className="grid size-8 shrink-0 place-items-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-fg disabled:opacity-50 cursor-pointer"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}

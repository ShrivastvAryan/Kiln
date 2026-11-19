'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutGrid, Menu, Plus, X } from 'lucide-react';
import { useHotkey } from '@/hooks/misc';
import { cn } from '@/lib/format';
import { LogoMark } from './LogoMark';
import { Kbd } from './ui';
import { UserMenu } from './UserMenu';

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
      <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 shadow-lg shadow-brand-500/20">
        <LogoMark className="size-[18px] text-white" />
      </span>
      <span>
        Kiln
      </span>
    </Link>
  );
}

const NAV = [
  { to: '/deployments', label: 'Deployments', icon: LayoutGrid, end: true },
  { to: '/new', label: 'New deployment', icon: Plus, kbd: 'N' },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex h-8 items-center px-2">
        <Logo />
      </div>
      <nav className="flex flex-col gap-0.5" aria-label="Main">
        {NAV.map(({ to, label, icon: Icon, end, kbd }) => {
          // "Deployments" also stays active on /deployments/[id] detail pages.
          const isActive = end ? pathname === to || pathname.startsWith('/deployments/') : pathname.startsWith(to);
          return (
            <Link
              key={to}
              href={to}
              onClick={onNavigate}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'group flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors',
                isActive ? 'bg-elevated font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg',
              )}
            >
              <Icon className="size-4" />
              <span className="flex-1">{label}</span>
              {kbd && <Kbd>{kbd}</Kbd>}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto">
        <UserMenu />
      </div>
    </div>
  );
}

/** App shell: persistent sidebar (drawer on mobile) shared by every route. */
export function Shell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  useHotkey('n', () => pathname !== '/new' && router.push('/new'));

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-72 animate-slide-up border-r border-line bg-surface">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-5 right-4 text-muted cursor-pointer"
              aria-label="Close menu"
            >
              <X className="size-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/80 px-4 backdrop-blur lg:hidden">
          <Logo />
          <button onClick={() => setOpen(true)} className="text-muted cursor-pointer" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
          {icon}
          {title}
        </h1>
        {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

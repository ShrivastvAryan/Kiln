'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutGrid, Menu, Moon, Plus, Server, Sun, X } from 'lucide-react';
import { useDeployments } from '@/hooks/deployments';
import { useHealth, useHotkey, useTheme } from '@/hooks/misc';
import { cn } from '@/lib/format';
import { LogoMark } from './LogoMark';
import { Kbd } from './ui';

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
  { to: '/system', label: 'Infrastructure', icon: Server },
];

function SystemStatus() {
  const { health, reachable } = useHealth();
  const { live } = useDeployments();
  const workers = health?.workers ?? [];
  const busy = workers.filter((w) => w.busyWith).length;

  const rows = [
    { label: 'API', ok: reachable, detail: live ? 'live' : reachable ? 'polling' : 'offline' },
    { label: 'Postgres', ok: reachable && !!health?.database, detail: health?.database ? 'connected' : 'down' },
    { label: 'Redis', ok: reachable && !!health?.redis, detail: health?.redis ? 'connected' : 'down' },
    {
      label: 'Storage',
      ok: reachable && !!health?.storage,
      detail: health ? (health.storageDriver === 's3' ? 'S3 / MinIO' : 'local disk') : '—',
    },
    {
      label: 'Workers',
      ok: workers.length > 0,
      detail: workers.length ? `${busy}/${workers.length} busy` : 'none online',
    },
  ];

  return (
    <Link
      href="/system"
      className="block rounded-lg border border-line bg-bg/50 p-3 text-xs transition-colors hover:border-line-strong"
    >
      <p className="mb-2 font-medium text-muted">System status</p>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-muted">
              <span className={cn('size-1.5 rounded-full', r.ok ? 'bg-success' : 'bg-danger')} />
              {r.label}
            </span>
            <span className="text-subtle">{r.detail}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { theme, toggle } = useTheme();
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
      <div className="mt-auto space-y-3">
        <SystemStatus />
        <button
          onClick={toggle}
          className="flex h-9 w-full items-center gap-3 rounded-lg px-3 text-sm text-muted transition-colors hover:bg-hover hover:text-fg cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
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

'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  ArrowUpRight,
  ChevronRight,
  Gauge,
  GitBranch,
  GitCommitHorizontal,
  Layers,
  Plus,
  Rocket,
  Search,
  Timer,
} from 'lucide-react';
import { ACTIVE_STATUSES, type Deployment, type DeploymentStatus } from '@deployx/shared/types';
import { GitHubConnectCard } from '@/components/GitHubConnectCard';
import { PageHeader } from '@/components/Layout';
import { Button, Card, GitHubIcon, Kbd, StatusBadge, StatusDot } from '@/components/ui';
import { useDeployments } from '@/hooks/deployments';
import { useHotkey, useNow } from '@/hooks/misc';
import { cn, displayUrl, formatDuration, repoHost, repoName, timeAgo } from '@/lib/format';

type Filter = 'all' | 'active' | 'ready' | 'failed';

const FILTERS: { key: Filter; label: string; match: (s: DeploymentStatus) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'active', label: 'In progress', match: (s) => ACTIVE_STATUSES.includes(s) },
  { key: 'ready', label: 'Ready', match: (s) => s === 'ready' },
  { key: 'failed', label: 'Failed', match: (s) => s === 'failed' },
];

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Activity;
  accent?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">{label}</p>
        <span className={cn('grid size-8 place-items-center rounded-lg bg-elevated', accent ?? 'text-muted')}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </Card>
  );
}

/** One app = every build of the same repository. Builds are newest first. */
interface App {
  repoUrl: string;
  latest: Deployment;
  builds: Deployment[];
  /** Most recent build that is live (ready), if any. */
  live?: Deployment;
}

function groupByApp(deployments: Deployment[]): App[] {
  const map = new Map<string, Deployment[]>();
  for (const d of [...deployments].sort((a, b) => b.createdAt - a.createdAt)) {
    const list = map.get(d.repoUrl);
    if (list) list.push(d);
    else map.set(d.repoUrl, [d]);
  }
  return [...map.entries()].map(([repoUrl, builds]) => ({
    repoUrl,
    latest: builds[0],
    builds,
    live: builds.find((b) => b.status === 'ready'),
  }));
}

function AppRow({ app, now }: { app: App; now: number }) {
  const d = app.latest;
  const active = ACTIVE_STATUSES.includes(d.status);
  const duration = active ? now - (d.startedAt ?? d.createdAt) : d.buildDurationMs;
  return (
    <li>
      <Link
        href={`/deployments/${d.id}`}
        className="group grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-hover/60 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_110px_100px_20px]"
      >
        {/* Project */}
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-bg text-muted">
            {repoHost(d.repoUrl) === 'github' ? <GitHubIcon className="size-4" /> : <Layers className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
              <span className="truncate">{repoName(d.repoUrl)}</span>
              {app.builds.length > 1 && (
                <span className="shrink-0 rounded-full bg-elevated px-1.5 py-px text-[10px] font-normal text-subtle tabular-nums">
                  {app.builds.length} builds
                </span>
              )}
            </p>
            <p className="flex min-w-0 items-center gap-1.5 text-xs text-subtle">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate">{d.branch || 'default'}</span>
              {d.commitSha && (
                <>
                  <GitCommitHorizontal className="ml-1 size-3 shrink-0" />
                  <span className="truncate font-mono">{d.commitSha.slice(0, 7)}</span>
                  <span className="hidden truncate sm:inline">· {d.commitMessage}</span>
                </>
              )}
            </p>
          </div>
        </div>

        {/* URL */}
        <div className="col-span-2 min-w-0 md:col-span-1">
          {d.status === 'ready' ? (
            <span className="inline-flex max-w-full items-center gap-1 truncate font-mono text-xs text-muted group-hover:text-fg">
              {displayUrl(d.appUrl ?? d.url)}
            </span>
          ) : d.status === 'failed' || d.status === 'cancelled' ? (
            <span className={cn('block truncate text-xs', d.status === 'failed' ? 'text-danger/90' : 'text-subtle')}>
              {d.status === 'failed' ? (d.error ?? 'Build failed') : 'Stopped'}
              {app.live && <span className="text-subtle"> · still live at {displayUrl(app.live.appUrl ?? app.live.url)}</span>}
            </span>
          ) : (
            <span className="text-xs text-subtle">{d.framework ?? 'Detecting framework…'}</span>
          )}
        </div>

        {/* Status */}
        <div className="row-start-1 md:row-auto">
          <StatusBadge status={d.status} paused={!!d.pausedAt} />
        </div>

        {/* Time */}
        <div className="hidden text-right text-xs text-subtle tabular-nums md:block">
          <p>{timeAgo(d.createdAt, now)}</p>
          <p className="mt-0.5">{formatDuration(duration)}</p>
        </div>
        <ChevronRight className="hidden size-4 text-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg md:block" />
      </Link>
    </li>
  );
}

function EmptyState() {
  return (
    <Card className="relative overflow-hidden px-6 py-16 text-center">
      <div className="bg-grid absolute inset-0 opacity-60" />
      <div className="relative">
        <span className="mx-auto grid size-12 place-items-center rounded-xl border border-line bg-elevated text-accent">
          <Rocket className="size-5" />
        </span>
        <h2 className="mt-5 text-lg font-semibold">Ship your first deployment</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
          Paste a public Git repository URL. Kiln clones it, detects the framework, builds it in an isolated worker and
          serves it on its own subdomain.
        </p>
        <Link href="/new" className="mt-6 inline-block">
          <Button variant="primary" icon={<Plus className="size-4" />}>
            New deployment
          </Button>
        </Link>
      </div>
    </Card>
  );
}

function SkeletonList() {
  return (
    <Card>
      <ul className="divide-y divide-line">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 px-5 py-4">
            <span className="size-9 animate-pulse rounded-lg bg-elevated" />
            <span className="flex-1 space-y-2">
              <span className="block h-3 w-40 animate-pulse rounded bg-elevated" />
              <span className="block h-2.5 w-64 animate-pulse rounded bg-elevated" />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function DashboardPage() {
  const { deployments, loading, error } = useDeployments();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const hasActive = deployments.some((d) => ACTIVE_STATUSES.includes(d.status));
  const now = useNow(1000, hasActive);
  useHotkey('/', () => searchRef.current?.focus());

  const apps = useMemo(() => groupByApp(deployments), [deployments]);

  const stats = useMemo(() => {
    const ready = deployments.filter((d) => d.status === 'ready');
    const failed = deployments.filter((d) => d.status === 'failed').length;
    const active = deployments.filter((d) => ACTIVE_STATUSES.includes(d.status)).length;
    const timed = ready.filter((d) => d.buildDurationMs).slice(0, 50);
    const avg = timed.length ? timed.reduce((s, d) => s + d.buildDurationMs!, 0) / timed.length : null;
    const finished = ready.length + failed;
    return {
      total: apps.length,
      builds: deployments.length,
      live: apps.filter((a) => a.live && !a.live.pausedAt).length,
      active,
      successRate: finished ? Math.round((ready.length / finished) * 100) : null,
      avg,
    };
  }, [deployments, apps]);

  // Filters and search work on apps, by the status of their latest build.
  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, apps.filter((a) => f.match(a.latest.status)).length])),
    [apps],
  );

  const filtered = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter)!;
    const q = query.trim().toLowerCase();
    return apps.filter(
      (a) =>
        f.match(a.latest.status) &&
        (!q ||
          a.repoUrl.toLowerCase().includes(q) ||
          a.builds.some(
            (d) => d.id.includes(q) || d.branch.toLowerCase().includes(q) || d.commitMessage?.toLowerCase().includes(q),
          )),
    );
  }, [apps, filter, query]);

  return (
    <>
      <PageHeader
        title="Deployments"
        description="One row per app. Open it to see the latest build and its history."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => router.push('/new')}>
            New deployment
            <span className="ml-1 hidden rounded bg-bg/15 px-1.5 font-mono text-[11px] sm:inline">N</span>
          </Button>
        }
      />

      <GitHubConnectCard />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Apps"
          value={String(stats.total)}
          hint={`${stats.live} live · ${stats.builds} build${stats.builds === 1 ? '' : 's'}`}
          icon={Layers}
        />
        <StatCard
          label="In progress"
          value={String(stats.active)}
          hint={stats.active ? 'Building now' : 'Workers idle'}
          icon={Activity}
          accent={stats.active ? 'text-warning' : undefined}
        />
        <StatCard
          label="Success rate"
          value={stats.successRate == null ? '—' : `${stats.successRate}%`}
          hint="Of finished builds"
          icon={Gauge}
          accent="text-success"
        />
        <StatCard label="Avg. build time" value={formatDuration(stats.avg)} hint="Last 50 builds" icon={Timer} />
      </div>

      {error && (
        <Card className="mb-6 border-danger/40 bg-danger-soft p-4 text-sm text-danger">
          {error} Start the backend with <code className="font-mono">npm run dev</code>.
        </Card>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors cursor-pointer',
                filter === f.key ? 'bg-elevated font-medium text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              {f.key === 'active' && counts.active > 0 && <StatusDot status="building" />}
              {f.label}
              <span className="text-xs text-subtle tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
            placeholder="Search apps, branches, commits…"
            aria-label="Search apps"
            className="h-9 w-full rounded-lg border border-line bg-surface pr-9 pl-9 text-sm placeholder:text-subtle focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none"
          />
          <span className="absolute top-1/2 right-2.5 -translate-y-1/2">
            <Kbd>/</Kbd>
          </span>
        </div>
      </div>

      {loading ? (
        <SkeletonList />
      ) : deployments.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <Card className="py-14 text-center text-sm text-muted">No apps match your filters.</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.4fr)_110px_100px_20px] gap-4 border-b border-line bg-elevated/40 px-5 py-2.5 text-xs font-medium text-subtle md:grid">
            <span>App</span>
            <span>Latest build</span>
            <span>Status</span>
            <span className="text-right">Created / Duration</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {filtered.map((a) => (
              <AppRow key={a.repoUrl} app={a} now={now} />
            ))}
          </ul>
        </Card>
      )}

      {deployments.some((d) => d.status === 'ready') && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-subtle">
          <ArrowUpRight className="size-3.5" /> Each app has a stable URL{' '}
          <code className="font-mono">http://&lt;app&gt;.localhost:3001</code> that serves its latest live build; every
          build also keeps its own <code className="font-mono">&lt;id&gt;</code> URL.
        </p>
      )}
    </>
  );
}

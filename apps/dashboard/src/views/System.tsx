'use client';

import Link from 'next/link';
import { Box, Cpu, Database, HardDrive, Network, Server, Zap } from 'lucide-react';
import { PageHeader } from '@/components/Layout';
import { Card } from '@/components/ui';
import { useDeployments } from '@/hooks/deployments';
import { useHealth, useNow } from '@/hooks/misc';
import type { WorkerInfo } from '@deployx/shared/types';
import { cn, formatDuration } from '@/lib/format';

function ServiceCard({
  icon: Icon,
  name,
  role,
  ok,
  detail,
}: {
  icon: typeof Server;
  name: string;
  role: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <span className="grid size-9 place-items-center rounded-lg bg-elevated text-muted">
          <Icon className="size-4" />
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
            ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
          )}
        >
          <span className={cn('size-1.5 rounded-full', ok ? 'bg-success' : 'bg-danger')} />
          {ok ? 'Healthy' : 'Down'}
        </span>
      </div>
      <p className="mt-4 text-sm font-medium">{name}</p>
      <p className="mt-0.5 text-xs text-subtle">{role}</p>
      <p className="mt-3 font-mono text-xs text-muted">{detail}</p>
    </Card>
  );
}

export function SystemPage() {
  const { health, reachable } = useHealth(3000);
  const { live, deployments } = useDeployments();
  const now = useNow(1000);
  const workers = health?.workers ?? [];

  return (
    <>
      <PageHeader
        title="Infrastructure"
        description="Live view of the control plane, data plane and build worker pool."
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <ServiceCard
          icon={Network}
          name="API / Uploader"
          role="REST + SSE control plane, clones repos"
          ok={reachable}
          detail={live ? 'event stream connected' : 'event stream offline'}
        />
        <ServiceCard
          icon={Database}
          name="PostgreSQL"
          role="Projects, deployments, archived logs"
          ok={reachable && !!health?.database}
          detail="Prisma ORM · source of truth"
        />
        <ServiceCard
          icon={Zap}
          name="Redis"
          role="Job queue, live logs, heartbeats"
          ok={reachable && !!health?.redis}
          detail="LPUSH / BRPOP · PUBLISH"
        />
        <ServiceCard
          icon={HardDrive}
          name="Object storage"
          role="Source snapshots + build output"
          ok={reachable && !!health?.storage}
          detail={health?.storageDriver === 's3' ? 'S3 API (MinIO)' : 'local filesystem driver'}
        />
        <ServiceCard
          icon={Cpu}
          name="Build workers"
          role="Concurrent build slots"
          ok={workers.length > 0}
          detail={`${workers.length} slot(s) online`}
        />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-medium">Worker pool</h2>
            <p className="mt-0.5 text-xs text-subtle">Workers send a heartbeat every 3s; stale entries expire after 10s.</p>
          </div>
          <span className="text-xs text-subtle tabular-nums">
            {workers.filter((w) => w.busyWith).length} busy / {workers.length} total
          </span>
        </div>
        {workers.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted">
            No workers online. Start one with <code className="font-mono text-fg">npm run dev:worker</code>.
          </div>
        ) : (
          <>
          {/* Phones: one stacked row per slot */}
          <ul className="divide-y divide-line sm:hidden">
            {workers.map((w) => {
              const job = w.busyWith ? deployments.find((d) => d.id === w.busyWith) : null;
              return (
                <li key={w.id} className="space-y-2 px-5 py-4 text-sm">
                  <p className="flex items-center gap-2 font-mono text-xs break-all">
                    <Box className="size-3.5 shrink-0 text-subtle" />
                    {w.id}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <WorkerState worker={w} jobName={job ? job.repoUrl.split('/').slice(-1)[0] : undefined} />
                    <IsolationBadge isolation={w.isolation} />
                    <span className="text-xs text-muted tabular-nums">up {formatDuration(now - w.startedAt)}</span>
                    <span className="font-mono text-xs text-subtle">pid {w.pid}</span>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Larger screens: table */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-subtle">
                  <th className="px-5 py-2.5 font-medium">Slot</th>
                  <th className="px-5 py-2.5 font-medium">State</th>
                  <th className="px-5 py-2.5 font-medium">Isolation</th>
                  <th className="px-5 py-2.5 font-medium">Uptime</th>
                  <th className="px-5 py-2.5 font-medium">PID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {workers.map((w) => {
                  const job = w.busyWith ? deployments.find((d) => d.id === w.busyWith) : null;
                  return (
                    <tr key={w.id}>
                      <td className="px-5 py-3 font-mono text-xs whitespace-nowrap">
                        <span className="inline-flex items-center gap-2">
                          <Box className="size-3.5 text-subtle" />
                          {w.id}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <WorkerState worker={w} jobName={job ? job.repoUrl.split('/').slice(-1)[0] : undefined} />
                      </td>
                      <td className="px-5 py-3">
                        <IsolationBadge isolation={w.isolation} />
                      </td>
                      <td className="px-5 py-3 text-muted tabular-nums">{formatDuration(now - w.startedAt)}</td>
                      <td className="px-5 py-3 font-mono text-xs text-muted">{w.pid}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
    </>
  );
}

function WorkerState({ worker, jobName }: { worker: WorkerInfo; jobName?: string }) {
  if (!worker.busyWith) {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted">
        <span className="size-1.5 rounded-full bg-success" /> Idle
      </span>
    );
  }
  return (
    <Link
      href={`/deployments/${worker.busyWith}`}
      className="inline-flex items-center gap-1.5 text-warning hover:underline"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-warning" />
      Building {jobName ?? worker.busyWith}
    </Link>
  );
}

function IsolationBadge({ isolation }: { isolation: WorkerInfo['isolation'] }) {
  return (
    <span
      className={cn(
        'rounded-md px-2 py-0.5 font-mono text-xs',
        isolation === 'docker' ? 'bg-info-soft text-info' : 'bg-warning-soft text-warning',
      )}
    >
      {isolation}
    </span>
  );
}

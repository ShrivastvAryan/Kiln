'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Cpu,
  ExternalLink,
  FileStack,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  Hammer,
  RotateCw,
  Trash2,
  User,
} from 'lucide-react';
import { ACTIVE_STATUSES, type Deployment } from '@deployx/shared/types';
import { LogConsole } from '@/components/LogConsole';
import { Pipeline } from '@/components/Pipeline';
import { Button, Card, CopyButton, Dialog, GitHubIcon, StatusBadge, useToast } from '@/components/ui';
import { useDeployments } from '@/hooks/deployments';
import { useNow } from '@/hooks/misc';
import { useLogStream } from '@/hooks/useLogStream';
import { api } from '@/lib/api';
import { displayUrl, formatBytes, formatDuration, repoName, timeAgo } from '@/lib/format';

function Detail({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs text-subtle">
        <Icon className="size-3.5" />
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm">{children}</dd>
    </div>
  );
}

function Preview({ d }: { d: Deployment }) {
  return (
    <a
      href={d.url}
      target="_blank"
      rel="noreferrer"
      className="group relative block aspect-[16/10] overflow-hidden rounded-lg border border-line bg-bg"
      aria-label="Open live deployment"
    >
      {d.status === 'ready' ? (
        <>
          <iframe
            src={d.url}
            title="Deployment preview"
            loading="lazy"
            tabIndex={-1}
            sandbox="allow-scripts allow-same-origin"
            className="pointer-events-none h-[400%] w-[400%] origin-top-left scale-25 border-0 bg-white"
          />
          <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-neutral-900">
              Visit <ExternalLink className="size-3" />
            </span>
          </span>
        </>
      ) : (
        <div className="bg-grid absolute inset-0 grid place-items-center">
          <span className="text-xs text-subtle">
            {d.status === 'failed' ? 'No preview: build failed' : 'Preview available when ready'}
          </span>
        </div>
      )}
    </a>
  );
}

export function DeploymentDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { byId, upsert, loading } = useDeployments();
  const [fetched, setFetched] = useState<Deployment | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<'redeploy' | 'delete' | null>(null);
  const deployment = byId.get(id) ?? fetched ?? null;
  const active = !!deployment && ACTIVE_STATUSES.includes(deployment.status);
  const now = useNow(1000, active);
  const logs = useLogStream(id);

  // Deep links: fetch directly if the list hasn't got it (yet).
  useEffect(() => {
    if (byId.has(id)) return;
    api
      .getDeployment(id)
      .then((d) => {
        setFetched(d);
        upsert(d);
      })
      .catch(() => setFetched(null));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Live status in the tab title; Next's metadata sets the title again on navigation.
    if (deployment) document.title = `${repoName(deployment.repoUrl)} · ${deployment.status} · Kiln`;
  },[deployment?.status, deployment?.repoUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!deployment) {
    if (loading || fetched === undefined)
      return <div className="h-64 animate-pulse rounded-xl border border-line bg-surface" />;
    return (
      <Card className="px-6 py-16 text-center">
        <h1 className="text-lg font-semibold">Deployment not found</h1>
        <p className="mt-2 text-sm text-muted">“{id}” doesn’t exist or was deleted.</p>
        <Link href="/deployments" className="mt-6 inline-block">
          <Button icon={<ArrowLeft className="size-4" />}>Back to deployments</Button>
        </Link>
      </Card>
    );
  }

  const d = deployment;
  const elapsed = active ? now - (d.startedAt ?? d.createdAt) : d.buildDurationMs;

  const redeploy = async () => {
    setBusy('redeploy');
    try {
      const next = await api.redeploy(d.id);
      upsert(next);
      toast({ tone: 'success', title: 'Redeploy started', description: `New deployment ${next.id}` });
      router.push(`/deployments/${next.id}`);
    } catch (e) {
      toast({ tone: 'error', title: 'Redeploy failed', description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      await api.deleteDeployment(d.id);
      toast({ tone: 'success', title: 'Deployment deleted', description: `${d.id} and its assets were removed.` });
      router.push('/deployments');
    } catch (e) {
      toast({ tone: 'error', title: 'Delete failed', description: (e as Error).message });
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  return (
    <>
      <Link href="/deployments" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Deployments
      </Link>

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words sm:truncate sm:text-2xl">{repoName(d.repoUrl)}</h1>
            <StatusBadge status={d.status} />
          </div>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span className="font-mono text-xs">{d.id}</span>
            <span className="text-subtle">·</span>
            <span>Created {timeAgo(d.createdAt, Date.now())}</span>
            {elapsed != null && (
              <>
                <span className="text-subtle">·</span>
                <span className="tabular-nums">
                  {active ? 'Running for ' : 'Built in '}
                  {formatDuration(elapsed)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            variant="ghost"
            icon={<Trash2 className="size-4" />}
            onClick={() => setConfirmDelete(true)}
            disabled={active}
            title={active ? 'Wait for the build to finish' : undefined}
          >
            Delete
          </Button>
          <Button icon={<RotateCw className="size-4" />} onClick={redeploy} loading={busy === 'redeploy'}>
            Redeploy
          </Button>
          {d.status === 'ready' && (
            <a href={d.url} target="_blank" rel="noreferrer">
              <Button variant="primary" icon={<ExternalLink className="size-4" />}>
                Visit
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Summary */}
      <Card className="mb-6 overflow-hidden">
        <div className="grid gap-6 p-6 md:grid-cols-[300px_minmax(0,1fr)]">
          <Preview d={d} />
          <div className="flex min-w-0 flex-col gap-6">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <dt className="flex items-center gap-1.5 text-xs text-subtle">
                  <Globe className="size-3.5" /> Domain
                </dt>
                <dd className="mt-1 flex items-center gap-1">
                  {d.status === 'ready' ? (
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate font-mono text-sm text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
                    >
                      {displayUrl(d.url)}
                    </a>
                  ) : (
                    <span className="truncate font-mono text-sm text-subtle">{displayUrl(d.url)}</span>
                  )}
                  <CopyButton value={d.url} label="Copy URL" />
                </dd>
              </div>
              <Detail icon={GitBranch} label="Source">
                <a
                  href={d.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1.5 hover:underline"
                >
                  <GitHubIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{d.branch || 'default branch'}</span>
                </a>
              </Detail>
              <Detail icon={GitCommitHorizontal} label="Commit">
                {d.commitSha ? (
                  <span title={d.commitMessage}>
                    <span className="font-mono text-xs">{d.commitSha.slice(0, 7)}</span>{' '}
                    <span className="text-muted">{d.commitMessage}</span>
                  </span>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </Detail>
              <Detail icon={Hammer} label="Framework">
                {d.framework ?? <span className="text-subtle">Detecting…</span>}
                {d.packageManager && d.packageManager !== 'none' && (
                  <span className="text-muted"> · {d.packageManager}</span>
                )}
              </Detail>
              <Detail icon={FileStack} label="Output">
                {d.fileCount != null ? (
                  <>
                    {d.fileCount} files · {formatBytes(d.totalBytes)}
                    {d.outputDir && d.outputDir !== '.' && (
                      <span className="font-mono text-xs text-muted"> ({d.outputDir}/)</span>
                    )}
                  </>
                ) : (
                  <span className="text-subtle">—</span>
                )}
              </Detail>
              <Detail icon={User} label="Author">
                {d.commitAuthor ?? <span className="text-subtle">—</span>}
              </Detail>
              <Detail icon={Cpu} label="Worker">
                {d.workerId ? <span className="font-mono text-xs">{d.workerId}</span> : <span className="text-subtle">Unassigned</span>}
              </Detail>
            </dl>
          </div>
        </div>
        <div className="border-t border-line bg-elevated/30 px-6 py-5">
          <Pipeline deployment={d} />
        </div>
      </Card>

      {d.status === 'failed' && d.error && (
        <div
          role="alert"
          className="mb-6 flex gap-3 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
          <div className="min-w-0">
            <p className="font-medium text-danger">Deployment failed</p>
            <p className="mt-1 break-words text-muted">{d.error}</p>
          </div>
        </div>
      )}

      <LogConsole
        lines={logs.lines}
        connected={logs.connected}
        loaded={logs.loaded}
        active={active}
        filename={`kiln-${d.id}.log`}
      />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete this deployment?"
        description={
          <>
            <span className="font-mono text-fg">{displayUrl(d.url)}</span> will stop serving immediately and its source,
            build output and logs will be permanently removed.
          </>
        }
      >
        <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
          Cancel
        </Button>
        <Button variant="danger" onClick={remove} loading={busy === 'delete'} icon={<Trash2 className="size-4" />}>
          Delete deployment
        </Button>
      </Dialog>
    </>
  );
}

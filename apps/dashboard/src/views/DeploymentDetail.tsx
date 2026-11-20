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
  History,
  Hammer,
  Pause,
  Play,
  RotateCw,
  Square,
  Trash2,
  User,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ACTIVE_STATUSES, type Deployment, type DeploymentStatus } from '@deployx/shared/types';
import CursorGrid from '@/components/react-bits/CursorGrid';
import { LogConsole } from '@/components/LogConsole';
import dynamic from 'next/dynamic';
import { DeploySteps } from '@/components/DeploySteps';
import { Button, Card, CopyButton, Dialog, GitHubIcon, StatusBadge, useToast } from '@/components/ui';
import { useDeployments } from '@/hooks/deployments';
import { useNow } from '@/hooks/misc';
import { useLogStream } from '@/hooks/useLogStream';
import { api } from '@/lib/api';
import { brand } from '@/theme/palette';
import { cn, displayUrl, formatBytes, formatDuration, repoName, timeAgo } from '@/lib/format';

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

// three.js (~1 MB) is only needed once someone opens the delete dialog: load it on demand.
const CrumpleDeleteDialog = dynamic(() => import('@/components/CrumpleDeleteDialog').then((m) => m.CrumpleDeleteDialog), {
  ssr: false,
});

/** How busy the grid looks at each stage: it idles while waiting and gets lively while building. */
const FIRING: Partial<Record<DeploymentStatus, { label: string; ambient: number; glow: number; pulseMs: number }>> = {
  cloning: { label: 'Cloning repository', ambient: 0.35, glow: 0.3, pulseMs: 2600 },
  queued: { label: 'Waiting for a worker', ambient: 0.15, glow: 0.2, pulseMs: 4200 },
  building: { label: 'Building', ambient: 0.6, glow: 0.55, pulseMs: 1800 },
  uploading: { label: 'Uploading output', ambient: 0.85, glow: 0.7, pulseMs: 1300 },
};

/**
 * Ambient grid behind the summary while a deployment is in progress (React Bits CursorGrid).
 * Fully automatic, it ignores the pointer: cells twinkle and rings ripple out more often as the
 * build gets busier. Fades out when the deployment ends.
 */
function FiringBackdrop({ status }: { status: DeploymentStatus }) {
  const f = FIRING[status];
  return (
    <AnimatePresence>
      {f && (
        <motion.div
          key="firing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.7 }}
          exit={{ opacity: 0, transition: { duration: 1.2 } }}
          transition={{ duration: 0.8 }}
          className="pointer-events-none absolute inset-0 -z-10"
          aria-hidden="true"
        >
          {/* Breathing ember glow under the grid: also the whole effect where WebGL2 is unavailable. */}
          <motion.div
            className="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 45% 80% at 18% 100%, var(--dx-accent-soft) 0%, transparent 70%), radial-gradient(ellipse 60% 50% at 50% 115%, var(--dx-accent-soft) 0%, transparent 80%)',
            }}
            animate={{ opacity: [0.3 + f.glow * 0.4, 0.5 + f.glow * 0.5, 0.3 + f.glow * 0.4] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          />
          <CursorGrid
            cellSize={44}
            color={brand[400]}
            gridColor={brand[300]}
            gridOpacity={0.06}
            fillOpacity={0.1}
            maxOpacity={0.85}
            radius={150}
            spotlight={0}
            interactive={false}
            autoPulse={f.pulseMs}
            holdTime={350}
            fadeDuration={900}
            ambient={f.ambient}
            edgeFade={0.12}
            clickPulse={false}
            style={{ position: 'absolute', inset: 0 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Preview({ d }: { d: Deployment }) {
  const firing = FIRING[d.status];
  return (
    <a
      href={d.url}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'group relative block aspect-[16/10] overflow-hidden rounded-lg border',
        firing ? 'border-accent/25 bg-bg shadow-[inset_0_0_40px_-12px_var(--dx-accent-soft)]' : 'border-line bg-bg',
      )}
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
          {d.pausedAt && (
            <span className="absolute inset-0 grid place-items-center bg-bg/75 backdrop-blur-[2px]">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning-soft px-3 py-1 text-xs font-medium text-warning">
                <Pause className="size-3" /> Paused
              </span>
            </span>
          )}
          <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-neutral-900">
              Visit <ExternalLink className="size-3" />
            </span>
          </span>
        </>
      ) : firing ? (
        <div className="absolute inset-0 grid place-items-center">
          <AnimatePresence mode="wait">
            <motion.span
              key={d.status}
              initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
              transition={{ duration: 0.35 }}
              className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-bg/70 px-3 py-1.5 text-xs font-medium text-fg shadow-lg backdrop-blur-md"
            >
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-accent" />
              </span>
              {firing.label}…
            </motion.span>
          </AnimatePresence>
        </div>
      ) : (
        <div className="bg-grid absolute inset-0 grid place-items-center">
          <span className="text-xs text-subtle">
            {d.status === 'failed'
              ? 'No preview: build failed'
              : d.status === 'cancelled'
                ? 'No preview: deployment stopped'
                : 'Preview available when ready'}
          </span>
        </div>
      )}
    </a>
  );
}

/** Every build of this app (same repository), newest first, numbered from the first one. */
function BuildHistory({ current, builds }: { current: Deployment; builds: Deployment[] }) {
  const [all, setAll] = useState(false);
  const LIMIT = 5;
  const shown = all ? builds : builds.slice(0, LIMIT);
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <History className="size-4 text-subtle" /> Builds
          <span className="rounded-full bg-elevated px-1.5 py-px text-[11px] font-normal text-subtle tabular-nums">
            {builds.length}
          </span>
        </h2>
        <span className="text-xs text-subtle">Every redeploy of this app is kept here</span>
      </div>
      <ul className="divide-y divide-line">
        {shown.map((b) => {
          const n = builds.length - builds.indexOf(b);
          const isCurrent = b.id === current.id;
          return (
            <li key={b.id}>
              <Link
                href={`/deployments/${b.id}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-2.5 text-sm transition-colors',
                  isCurrent ? 'bg-accent-soft' : 'hover:bg-hover/60',
                )}
              >
                <span className="w-8 font-mono text-xs text-subtle tabular-nums">#{n}</span>
                <span className="flex min-w-0 items-center gap-2.5">
                  <StatusBadge status={b.status} paused={!!b.pausedAt} />
                  <span className="truncate text-xs text-muted">
                    {b.commitSha ? (
                      <>
                        <span className="font-mono">{b.commitSha.slice(0, 7)}</span>
                        {b.commitMessage && ` · ${b.commitMessage}`}
                      </>
                    ) : (
                      <span className="font-mono">{b.id}</span>
                    )}
                  </span>
                </span>
                <span className="flex items-center gap-3 text-xs text-subtle tabular-nums">
                  {isCurrent && (
                    <span className="rounded-full bg-accent px-2 py-px text-[10px] font-semibold text-accent-fg">Viewing</span>
                  )}
                  <span className="hidden sm:inline">{formatDuration(b.buildDurationMs)}</span>
                  <span>{timeAgo(b.createdAt, Date.now())}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {builds.length > LIMIT && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="w-full border-t border-line px-5 py-2 text-xs text-muted transition-colors hover:bg-hover/60 hover:text-fg cursor-pointer"
        >
          {all ? 'Show fewer' : `Show all ${builds.length} builds`}
        </button>
      )}
    </Card>
  );
}

export function DeploymentDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const { byId, upsert, remove: removeLocal, loading, deployments } = useDeployments();
  const [fetched, setFetched] = useState<Deployment | null | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Mount (and download) the 3D delete dialog only once Delete has been clicked.
  const [deleteUsed, setDeleteUsed] = useState(false);
  const [busy, setBusy] = useState<'delete' | 'stop' | 'pause' | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
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
  // Every build of this app, newest first; the newest ready one is what the app URL serves.
  const builds = deployments.filter((b) => b.repoUrl === d.repoUrl).sort((a, b) => b.createdAt - a.createdAt);
  const appLive = builds.find((b) => b.status === 'ready');
  const isAppLive = appLive?.id === d.id;
  const elapsed = active ? now - (d.startedAt ?? d.createdAt) : d.buildDurationMs;

  /** Starts a new build of this app and opens it; its page follows the build live. */
  const redeploy = async () => {
    setRedeploying(true);
    try {
      const next = await api.redeploy(d.id);
      upsert(next);
      router.push(`/deployments/${next.id}`);
    } catch (e) {
      toast({ tone: 'error', title: 'Could not redeploy', description: (e as Error).message });
      setRedeploying(false);
    }
  };


  const stop = async () => {
    setBusy('stop');
    try {
      upsert(await api.cancelDeployment(d.id));
      toast({ tone: 'success', title: 'Deployment stopped', description: `${d.id} will not go live.` });
    } catch (e) {
      toast({ tone: 'error', title: 'Could not stop the deployment', description: (e as Error).message });
    } finally {
      setBusy(null);
      setConfirmStop(false);
    }
  };

  const togglePause = async () => {
    const pausing = !d.pausedAt;
    setBusy('pause');
    try {
      upsert(await (pausing ? api.pauseDeployment(d.id) : api.resumeDeployment(d.id)));
      toast({
        tone: 'success',
        title: pausing ? 'Deployment paused' : 'Deployment resumed',
        description: pausing ? 'Visitors now see a "paused" page.' : `${displayUrl(d.url)} is live again.`,
      });
    } catch (e) {
      toast({ tone: 'error', title: pausing ? 'Could not pause' : 'Could not resume', description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      const { deleted } = await api.deleteDeployment(d.id);
      toast({
        tone: 'success',
        title: 'App deleted',
        description: `${repoName(d.repoUrl)} and ${deleted.length === 1 ? 'its build were' : `all ${deleted.length} builds were`} removed.`,
      });
      router.push('/deployments');
      // The live event stream removes them too; don't wait for it (but leave this page first, or it
      // would flash "not found").
      window.setTimeout(() => deleted.forEach(removeLocal), 0);
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
            <StatusBadge status={d.status} paused={!!d.pausedAt} />
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
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            icon={<Trash2 className="size-4" />}
            onClick={() => {
              setDeleteUsed(true);
              setConfirmDelete(true);
            }}
            title="Delete this app and all its builds"
          >
            Delete
          </Button>
          {active ? (
            <Button
              variant="secondary"
              className="text-danger hover:border-danger/40 hover:bg-danger-soft"
              icon={<Square className="size-3.5 fill-current" />}
              onClick={() => setConfirmStop(true)}
              loading={busy === 'stop'}
            >
              Stop
            </Button>
          ) : (
            <Button icon={<RotateCw className="size-4" />} onClick={redeploy} loading={redeploying}>
              Redeploy
            </Button>
          )}
          {d.status === 'ready' && (
            <Button
              icon={d.pausedAt ? <Play className="size-4" /> : <Pause className="size-4" />}
              onClick={togglePause}
              loading={busy === 'pause'}
            >
              {d.pausedAt ? 'Resume' : 'Pause'}
            </Button>
          )}
          {d.status === 'ready' && !d.pausedAt && (
            <a href={isAppLive && d.appUrl ? d.appUrl : d.url} target="_blank" rel="noreferrer">
              <Button variant="primary" icon={<ExternalLink className="size-4" />}>
                Visit
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Summary */}
      <Card className="relative isolate mb-6 overflow-hidden">
        <FiringBackdrop status={d.status} />
        <div className="grid gap-6 p-6 md:grid-cols-[300px_minmax(0,1fr)]">
          <Preview d={d} />
          <div className="flex min-w-0 flex-col gap-6">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <dt className="flex items-center gap-1.5 text-xs text-subtle">
                  <Globe className="size-3.5" /> App URL
                  {isAppLive && (
                    <span className="rounded-full bg-success-soft px-1.5 py-px text-[10px] font-medium text-success">
                      serving this build
                    </span>
                  )}
                </dt>
                {d.appUrl ? (
                  <dd className="mt-1 flex items-center gap-1">
                    {appLive ? (
                      <a
                        href={d.appUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate font-mono text-sm text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg"
                      >
                        {displayUrl(d.appUrl)}
                      </a>
                    ) : (
                      <span className="truncate font-mono text-sm text-subtle">{displayUrl(d.appUrl)}</span>
                    )}
                    <CopyButton value={d.appUrl} label="Copy app URL" />
                  </dd>
                ) : null}
                <dd className="mt-1.5 flex items-center gap-1 text-xs text-subtle">
                  <span className="shrink-0">This build:</span>
                  {d.status === 'ready' ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="truncate font-mono hover:text-fg hover:underline">
                      {displayUrl(d.url)}
                    </a>
                  ) : (
                    <span className="truncate font-mono">{displayUrl(d.url)}</span>
                  )}
                  <CopyButton value={d.url} label="Copy build URL" />
                  {!isAppLive && appLive && (
                    <Link href={`/deployments/${appLive.id}`} className="ml-1 shrink-0 text-accent hover:underline">
                      app is serving {appLive.id}
                    </Link>
                  )}
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
                {d.framework?.endsWith('(server)') ? (
                  <>
                    Node server
                    {d.outputDir && d.outputDir !== '.' && (
                      <span className="font-mono text-xs text-muted"> ({d.outputDir}/)</span>
                    )}
                  </>
                ) : d.fileCount != null ? (
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
        {/* Live progress while it builds; stays after a failure or stop to show where it ended. */}
        {d.status !== 'ready' && (
          <div className="border-t border-line px-4 py-5 sm:px-6">
            <DeploySteps d={d} />
          </div>
        )}
      </Card>

      {d.status === 'ready' && d.pausedAt && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm sm:flex-row sm:items-center">
          <Pause className="size-4 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-warning">Deployment paused</p>
            <p className="mt-0.5 text-muted">
              Paused {timeAgo(d.pausedAt, Date.now())}. Visitors to{' '}
              <span className="font-mono text-fg">{displayUrl(d.url)}</span> see a “paused” page until you resume it.
            </p>
          </div>
          <Button size="sm" icon={<Play className="size-3.5" />} onClick={togglePause} loading={busy === 'pause'}>
            Resume
          </Button>
        </div>
      )}

      {d.status === 'cancelled' && (
        <div className="mb-6 flex gap-3 rounded-xl border border-line-strong bg-elevated p-4 text-sm">
          <Square className="mt-0.5 size-4 shrink-0 fill-current text-muted" />
          <div className="min-w-0">
            <p className="font-medium">Deployment stopped</p>
            <p className="mt-1 text-muted">It was stopped before going live. Redeploy to build it again.</p>
          </div>
        </div>
      )}

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

      {builds.length > 1 && <BuildHistory current={d} builds={builds} />}

      <LogConsole
        lines={logs.lines}
        connected={logs.connected}
        loaded={logs.loaded}
        active={active}
        filename={`kiln-${d.id}.log`}
      />


      <Dialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title="Stop this deployment?"
        description="The build is killed right away and nothing goes live. Logs so far are kept, and you can redeploy at any time."
      >
        <Button variant="ghost" onClick={() => setConfirmStop(false)}>
          Keep building
        </Button>
        <Button variant="danger" onClick={stop} loading={busy === 'stop'} icon={<Square className="size-3.5 fill-current" />}>
          Stop deployment
        </Button>
      </Dialog>

      {deleteUsed && <CrumpleDeleteDialog
        open={confirmDelete}
        deployment={d}
        buildCount={builds.length}
        busy={busy === 'delete'}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
      />}
    </>
  );
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertTriangle, ArrowRight, Check, Loader2, Square, X } from 'lucide-react';
import { ACTIVE_STATUSES, type Deployment } from '@deployx/shared/types';
import { useDeployments } from '@/hooks/deployments';
import { api } from '@/lib/api';
import { cn, displayUrl, formatBytes, repoName } from '@/lib/format';
import { hashString } from '@/lib/receipt';
import { STEPS, stepStates, type StepState } from './Pipeline';
import { LogoMark } from './LogoMark';
import { Button, useToast } from './ui';

/** Each ticket line takes this long to print (lines queue up if steps finish faster). */
const LINE_MS = 650;
/** After the deployment finishes (and the ticket is printed) the dialog closes itself after this long. */
const AUTO_CLOSE_MS = 10_000;
const PAPER = '#f5f0e6';
const INK = '#2a2622';
const FADED = '#8a8178';

/** Thermal-printer feel: short bursts with tiny pauses. */
const printerEase = (t: number) => {
  const n = 8;
  const i = Math.floor(t * n);
  const f = t * n - i;
  return Math.min(1, (i + Math.min(1, f * 2)) / n);
};

type Entry =
  | { kind: 'header'; key: 'header' }
  | { kind: 'line'; key: string; label: string; detail: string; state: StepState }
  | { kind: 'footer'; key: 'footer'; result: 'live' | 'failed' | 'stopped' };

/** What each finished step contributes to the ticket and the step list. */
function stepDetail(d: Deployment, index: number) {
  switch (STEPS[index].key) {
    case 'cloning':
      return d.commitSha ? `${d.commitSha.slice(0, 7)} · ${d.branch || 'default'}` : d.branch || 'default branch';
    case 'queued':
      return d.workerId ? `worker ${d.workerId.replace(/^(.{6}).*(#\d+)$/, '$1…$2')}` : 'waiting for a worker';
    case 'building':
      return d.framework ?? 'detecting framework';
    case 'uploading':
      return d.fileCount != null ? `${d.fileCount} files · ${formatBytes(d.totalBytes)}` : 'uploading output';
    default:
      return displayUrl(d.appUrl ?? d.url);
  }
}

/**
 * Deploy / redeploy dialog. Starts the request, then follows the deployment live through
 * Clone → Queue → Build → Upload → Live while a ticket prints one line per finished step.
 * Close (✕, Esc, "View build") any time to open the build; it also closes itself 10 s after the
 * deployment finishes. "Stop" cancels it mid-way.
 */
export function DeployDialog({
  open,
  title,
  run,
  redeployOf,
  onClose,
}: {
  open: boolean;
  /** e.g. "Deploying mdn/todo-react". */
  title: string;
  /** Starts the deployment. Rejecting shows the error in the dialog. */
  run: () => Promise<Deployment>;
  redeployOf?: string;
  /** Called once, with the new deployment, or null if it couldn't be started. */
  onClose: (deployment: Deployment | null) => void;
}) {
  const reduce = useReducedMotion();
  const toast = useToast();
  const { byId, upsert } = useDeployments();
  const [created, setCreated] = useState<Deployment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [printed, setPrinted] = useState(0);
  const [stopping, setStopping] = useState(false);
  const printedAt = useRef(new Map<string, string>());
  const result = useRef<Deployment | null | undefined>(undefined); // undefined = request still running
  const closed = useRef(false);
  const done = useRef(false);

  const live = created ? (byId.get(created.id) ?? created) : null;
  const finished = !!live && !ACTIVE_STATUSES.includes(live.status);

  /** Report back exactly once, when the user has closed and the request has settled. */
  const settle = () => {
    if (done.current || !closed.current || result.current === undefined) return;
    done.current = true;
    onClose(result.current);
  };
  const close = () => {
    closed.current = true;
    setHidden(true);
    settle();
  };

  // Start the request each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    closed.current = false;
    done.current = false;
    result.current = undefined;
    printedAt.current.clear();
    setHidden(false);
    setCreated(null);
    setError(null);
    setPrinted(0);
    setStopping(false);
    let alive = true;
    run()
      .then((d) => {
        result.current = d;
        if (alive) setCreated(d);
        settle();
      })
      .catch((e: Error) => {
        result.current = null;
        if (alive) setError(e.message || 'Something went wrong.');
        settle();
      });
    return () => {
      alive = false;
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Everything the ticket should show by now: header, a line per finished step, then the footer.
  const states = live ? stepStates(live) : null;
  const entries = useMemo<Entry[]>(() => {
    if (!live || !states) return [];
    const list: Entry[] = [{ kind: 'header', key: 'header' }];
    states.forEach((state, i) => {
      if (state === 'done' || state === 'failed' || state === 'stopped')
        list.push({
          key: STEPS[i].key,
          kind: 'line',
          label: STEPS[i].label.toUpperCase(),
          detail: state === 'failed' ? (live.error ?? 'failed') : state === 'stopped' ? 'stopped by you' : stepDetail(live, i),
          state,
        });
    });
    if (finished)
      list.push({ kind: 'footer', key: 'footer', result: live.status === 'ready' ? 'live' : live.status === 'cancelled' ? 'stopped' : 'failed' });
    return list;
  }, [live, states?.join(), finished]); // eslint-disable-line react-hooks/exhaustive-deps

  // Print one entry at a time, even if several steps finished at once.
  useEffect(() => {
    if (printed >= entries.length) return;
    const t = window.setTimeout(
      () => {
        const next = entries[printed];
        printedAt.current.set(
          next.key,
          new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        );
        setPrinted((n) => n + 1);
      },
      reduce ? 0 : printed === 0 ? 250 : LINE_MS,
    );
    return () => window.clearTimeout(t);
  }, [printed, entries, reduce]);

  const fullyPrinted = finished && printed >= entries.length;

  // Auto-close once the deployment is over and its ticket is printed.
  useEffect(() => {
    if (!open || hidden || (!fullyPrinted && !error)) return;
    const t = window.setTimeout(close, AUTO_CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [open, hidden, fullyPrinted, error]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || hidden) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = async () => {
    if (!live) return;
    setStopping(true);
    try {
      upsert(await api.cancelDeployment(live.id));
    } catch (e) {
      toast({ tone: 'error', title: 'Could not stop the deployment', description: (e as Error).message });
    } finally {
      setStopping(false);
    }
  };

  const subtitle = error
    ? 'The deployment could not be started.'
    : !live
      ? 'Starting…'
      : live.status === 'ready'
        ? 'Live! Your ticket is printed.'
        : live.status === 'failed'
          ? 'The build failed.'
          : live.status === 'cancelled'
            ? 'Stopped.'
            : 'Following your deployment live…';

  // Step list: before the request returns, "Clone" is the active step.
  const listStates: StepState[] = states ?? STEPS.map((_, i) => (error ? (i === 0 ? 'failed' : 'pending') : i === 0 ? 'active' : 'pending'));

  return (
    <AnimatePresence>
      {open && !hidden && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <motion.div
            className="fixed inset-0 bg-black/65 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={close}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="deploy-dialog-title"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.2, 0.9, 0.3, 1] }}
            className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 id="deploy-dialog-title" className="truncate text-base font-semibold">
                  {title}
                </h2>
                <p className="mt-0.5 text-xs text-subtle" aria-live="polite">
                  {subtitle}
                </p>
              </div>
              <CloseButton onClick={close} countdown={fullyPrinted || !!error} />
            </div>

            <div className="grid md:grid-cols-[minmax(0,1fr)_300px]">
              {/* Live pipeline */}
              <div className="flex flex-col p-5">
                <ol className="relative space-y-1">
                  {STEPS.map((step, i) => {
                    const state = listStates[i];
                    const Icon = step.icon;
                    return (
                      <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
                        {i < STEPS.length - 1 && (
                          <span className="absolute top-8 bottom-0 left-[15px] w-px overflow-hidden bg-line">
                            <motion.span
                              className="block w-full bg-success"
                              initial={false}
                              animate={{ height: state === 'done' ? '100%' : '0%' }}
                              transition={{ duration: 0.5 }}
                            />
                          </span>
                        )}
                        <span
                          className={cn(
                            'relative grid size-8 shrink-0 place-items-center rounded-full border transition-colors duration-300',
                            state === 'done' && 'border-success/40 bg-success-soft text-success',
                            state === 'active' && 'border-accent bg-accent-soft text-accent',
                            state === 'failed' && 'border-danger/50 bg-danger-soft text-danger',
                            state === 'stopped' && 'border-line-strong bg-elevated text-muted',
                            state === 'pending' && 'border-line bg-bg text-subtle',
                          )}
                        >
                          {state === 'active' && (
                            <span className="absolute inset-[-3px] animate-spin rounded-full border-2 border-transparent border-t-accent [animation-duration:1.2s]" />
                          )}
                          {state === 'done' ? (
                            <Check className="size-4" />
                          ) : state === 'failed' ? (
                            <X className="size-4" />
                          ) : state === 'stopped' ? (
                            <Square className="size-3 fill-current" />
                          ) : (
                            <Icon className="size-3.5" />
                          )}
                        </span>
                        <div className="min-w-0 pt-1">
                          <p
                            className={cn(
                              'text-sm font-medium',
                              state === 'pending' && 'text-subtle',
                              state === 'failed' && 'text-danger',
                            )}
                          >
                            {step.label}
                          </p>
                          <p className="truncate text-xs text-subtle">
                            {live && state !== 'pending'
                              ? state === 'failed'
                                ? (live.error ?? 'Failed')
                                : state === 'stopped'
                                  ? 'Stopped by you'
                                  : stepDetail(live, i)
                              : state === 'active'
                                ? 'Starting…'
                                : ' '}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>

                {error && (
                  <div className="mt-4 flex gap-2.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                    <span className="break-words text-muted">{error}</span>
                  </div>
                )}
              </div>

              {/* Printer + ticket */}
              <div className="flex flex-col items-center border-t border-line bg-bg/50 px-6 pt-5 md:border-t-0 md:border-l">
                <div className="relative z-10 flex h-10 w-[264px] items-center justify-between rounded-xl border border-line-strong bg-linear-to-b from-elevated to-surface px-4 shadow-lg">
                  <span className="font-mono text-[9px] tracking-[0.2em] text-subtle uppercase">Kiln · ticket</span>
                  <span className="flex items-center gap-1.5 text-[10px] text-subtle">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        error || live?.status === 'failed'
                          ? 'bg-danger'
                          : fullyPrinted
                            ? 'bg-success'
                            : 'animate-pulse bg-accent',
                      )}
                    />
                    {error ? 'Error' : fullyPrinted ? 'Done' : printed < entries.length ? 'Printing' : 'Waiting'}
                  </span>
                  <span className="absolute inset-x-5 -bottom-px h-1 rounded-full bg-black/80 shadow-[inset_0_1px_2px_rgba(0,0,0,0.9)]" />
                </div>

                <div className="relative -mt-px h-[392px] w-[264px] overflow-hidden">
                  {!live && !error && (
                    <div className="absolute inset-0 grid place-items-center">
                      <span className="flex flex-col items-center gap-3 text-xs text-subtle">
                        <Loader2 className="size-5 animate-spin text-accent" />
                        Preparing your ticket…
                      </span>
                    </div>
                  )}
                  {live && printed > 0 && (
                    <Ticket
                      deployment={live}
                      redeployOf={redeployOf}
                      entries={entries.slice(0, printed)}
                      times={printedAt.current}
                      reduce={!!reduce}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-line bg-bg/40 px-5 py-3">
              <span className="text-[11px] text-subtle">
                {fullyPrinted || error ? 'Closes automatically in 10 s' : ' '}
              </span>
              <div className="flex gap-2">
                {live && !finished && (
                  <Button
                    variant="ghost"
                    className="text-danger hover:bg-danger-soft"
                    icon={<Square className="size-3 fill-current" />}
                    onClick={stop}
                    loading={stopping}
                  >
                    Stop
                  </Button>
                )}
                {error ? (
                  <Button onClick={close}>Close</Button>
                ) : (
                  <Button variant="primary" onClick={close} disabled={!created}>
                    View build <ArrowRight className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

// ── Ticket ─────────────────────────────────────────────────────────────────────

function Ticket({
  deployment: d,
  redeployOf,
  entries,
  times,
  reduce,
}: {
  deployment: Deployment;
  redeployOf?: string;
  entries: Entry[];
  times: Map<string, string>;
  reduce: boolean;
}) {
  // Each new entry is "burned" in top to bottom, like a thermal print head.
  const burn = {
    initial: reduce ? false : ({ clipPath: 'inset(0 0 100% 0)' } as const),
    animate: { clipPath: 'inset(0 0 0% 0)' },
    transition: { duration: reduce ? 0 : 0.5, ease: printerEase },
  };

  return (
    <motion.div
      layout={!reduce}
      transition={{ layout: { duration: 0.5, ease: printerEase } }}
      className="absolute top-0 left-2 w-[248px] font-mono"
      style={{ background: PAPER, color: INK }}
    >
      {/* Printer-lip shadow */}
      <span className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-linear-to-b from-black/30 to-transparent" />

      {entries.map((e) => {
        if (e.kind === 'header') {
          return (
            <motion.div key="header" {...burn} layout="position" className="px-4 pt-4 pb-2">
              <div className="flex items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-linear-to-br from-brand-400 to-brand-600 text-white">
                  <LogoMark className="size-4" />
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="font-sans text-sm font-bold">Kiln</p>
                  <p className="text-[8px] tracking-wider" style={{ color: FADED }}>
                    {redeployOf ? 'REDEPLOY TICKET' : 'DEPLOY TICKET'}
                  </p>
                </div>
                <div className="text-right text-[8px] leading-tight" style={{ color: FADED }}>
                  <p>#{d.id.toUpperCase()}</p>
                  <p>{new Date(d.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
              <Rule />
              <p className="truncate font-sans text-[13px] font-bold">{repoName(d.repoUrl)}</p>
              <p className="truncate text-[9px]" style={{ color: FADED }}>
                {displayUrl(d.url)}
                {redeployOf && ` · from #${redeployOf}`}
              </p>
              <Rule />
            </motion.div>
          );
        }
        if (e.kind === 'line') {
          const mark = e.state === 'done' ? '✓' : e.state === 'failed' ? '✗' : '■';
          const color = e.state === 'done' ? '#15803d' : e.state === 'failed' ? '#be123c' : FADED;
          return (
            <motion.div key={e.key} {...burn} layout="position" className="flex items-baseline gap-1.5 px-4 py-[3px] text-[10px]">
              <span className="w-3 shrink-0 font-bold" style={{ color }}>
                {mark}
              </span>
              <span className="w-12 shrink-0 font-semibold">{e.label}</span>
              <span className="min-w-0 flex-1 truncate" style={{ color: e.state === 'done' ? INK : color }}>
                {e.detail}
              </span>
              <span className="shrink-0 text-[8px]" style={{ color: FADED }}>
                {times.get(e.key)}
              </span>
            </motion.div>
          );
        }
        return <TicketFooter key="footer" id={d.id} result={e.result} burn={burn} />;
      })}

      {/* Torn bottom edge */}
      <svg className="absolute -bottom-[5px] left-0" width="248" height="6" viewBox="0 0 248 6" aria-hidden="true">
        <path
          d={`M0 0 ${Array.from({ length: 25 }, (_, i) => `L${i * 10 + 5} 6 L${Math.min(248, i * 10 + 10)} 0`).join(' ')} Z`}
          fill={PAPER}
        />
      </svg>
      {/* Breathing room under the last line */}
      <div className="h-2" />
    </motion.div>
  );
}

function Rule() {
  return <div className="my-2 border-t border-dashed" style={{ borderColor: '#c9c0b4' }} />;
}

function TicketFooter({
  id,
  result,
  burn,
}: {
  id: string;
  result: 'live' | 'failed' | 'stopped';
  burn: Record<string, unknown>;
}) {
  const bars = useMemo(() => {
    let seed = hashString(id);
    const rand = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0) % 1000) / 1000;
    const list: { x: number; w: number }[] = [];
    for (let x = 0; x < 216; ) {
      const w = 1 + Math.floor(rand() * 3);
      if (rand() > 0.35) list.push({ x, w });
      x += w + 1 + Math.floor(rand() * 2);
    }
    return list;
  }, [id]);
  const stamp = {
    live: { text: 'LIVE', color: 'rgba(21, 128, 61, 0.85)' },
    failed: { text: 'FAILED', color: 'rgba(225, 29, 72, 0.8)' },
    stopped: { text: 'STOPPED', color: 'rgba(87, 83, 78, 0.8)' },
  }[result];

  return (
    <motion.div {...burn} layout="position" className="relative px-4 pt-1 pb-3">
      <Rule />
      <svg width="216" height="30" viewBox="0 0 216 30" aria-hidden="true">
        {bars.map((b) => (
          <rect key={b.x} x={b.x} y={0} width={b.w} height={30} fill={INK} />
        ))}
      </svg>
      <p className="mt-1 text-center text-[8px]" style={{ color: FADED }}>
        {id}
      </p>
      <motion.span
        initial={{ scale: 1.8, opacity: 0, rotate: -12 }}
        animate={{ scale: 1, opacity: 1, rotate: -12 }}
        transition={{ delay: 0.45, type: 'spring', stiffness: 500, damping: 22 }}
        className="absolute right-4 bottom-8 rounded-md border-2 px-2 py-0.5 text-sm font-bold"
        style={{ borderColor: stamp.color, color: stamp.color }}
      >
        {stamp.text}
      </motion.span>
    </motion.div>
  );
}

/** ✕ button; once the deployment is over, a ring drains over the auto-close time. */
function CloseButton({ onClick, countdown }: { onClick: () => void; countdown: boolean }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={countdown ? 'Close (closes automatically in 10 seconds)' : 'Close'}
      className="relative grid size-8 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:bg-hover hover:text-fg cursor-pointer"
    >
      {countdown && (
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r={r} fill="none" stroke="var(--dx-line)" strokeWidth="2" />
          <motion.circle
            cx="16"
            cy="16"
            r={r}
            fill="none"
            stroke="var(--dx-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: 0 }}
            animate={{ strokeDashoffset: c }}
            transition={{ duration: AUTO_CLOSE_MS / 1000, ease: 'linear' }}
          />
        </svg>
      )}
      <X className="relative size-3.5" />
    </button>
  );
}

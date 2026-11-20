'use client';

import { motion } from 'motion/react';
import { Check, Square, X } from 'lucide-react';
import type { Deployment } from '@deployx/shared/types';
import { cn, displayUrl, formatBytes } from '@/lib/format';
import { STEPS, stepStates } from './Pipeline';

/** The detail line shown under a step that has started. */
function stepDetail(d: Deployment, index: number) {
  switch (STEPS[index].key) {
    case 'cloning':
      return d.commitSha ? `${d.commitSha.slice(0, 7)} · ${d.branch || 'default'}` : `Cloning ${d.branch || 'default branch'}…`;
    case 'queued':
      return d.workerId ? `worker ${d.workerId.replace(/^(.{6}).*(#\d+)$/, '$1…$2')}` : 'Waiting for a worker…';
    case 'building':
      return d.framework ?? 'Detecting framework…';
    case 'uploading':
      if (d.framework?.endsWith('(server)')) return 'Node server started';
      return d.fileCount != null ? `${d.fileCount} files · ${formatBytes(d.totalBytes)}` : 'Uploading output…';
    default:
      return displayUrl(d.appUrl ?? d.url);
  }
}

/** Clone → Queue → Build → Upload → Live as a horizontal stepper that follows the deployment live. */
export function DeploySteps({ d, className }: { d: Deployment; className?: string }) {
  const states = stepStates(d);
  return (
    <ol className={cn('flex', className)} aria-label="Deployment progress">
      {STEPS.map((step, i) => {
        const state = states[i];
        const Icon = step.icon;
        return (
          <li
            key={step.key}
            className="relative flex min-w-0 flex-1 flex-col items-center text-center"
            aria-current={state === 'active' ? 'step' : undefined}
          >
            {/* Connector to the next step: fills in green once this step is done. */}
            {i < STEPS.length - 1 && (
              <span className="absolute top-4 right-[calc(-50%+22px)] left-[calc(50%+22px)] h-px overflow-hidden bg-line">
                <motion.span
                  className="block h-full bg-success"
                  initial={false}
                  animate={{ width: state === 'done' ? '100%' : '0%' }}
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
            <p
              className={cn(
                'mt-2 text-sm font-medium leading-tight',
                state === 'pending' && 'text-subtle',
                state === 'failed' && 'text-danger',
              )}
            >
              {step.label}
            </p>
            <p className="mt-0.5 w-full truncate px-1 text-xs text-subtle">
              {state === 'pending'
                ? ' '
                : state === 'failed'
                  ? 'Failed'
                  : state === 'stopped'
                    ? 'Stopped by you'
                    : stepDetail(d, i)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

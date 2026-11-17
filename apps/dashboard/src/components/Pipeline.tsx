'use client';

import { Check, GitBranch, Hammer, Inbox, Rocket, UploadCloud, X } from 'lucide-react';
import type { Deployment, DeploymentStatus } from '@deployx/shared/types';
import { cn } from '@/lib/format';

const STEPS: { key: DeploymentStatus; label: string; icon: typeof Check }[] = [
  { key: 'cloning', label: 'Clone', icon: GitBranch },
  { key: 'queued', label: 'Queue', icon: Inbox },
  { key: 'building', label: 'Build', icon: Hammer },
  { key: 'uploading', label: 'Upload', icon: UploadCloud },
  { key: 'ready', label: 'Live', icon: Rocket },
];

/** Which step a failed deployment died in, inferred from the fields it reached. */
function failedStep(d: Deployment) {
  if (!d.startedAt) return d.commitSha ? 1 : 0;
  if (d.outputDir) return 3;
  return 2;
}

export function Pipeline({ deployment }: { deployment: Deployment }) {
  const failed = deployment.status === 'failed';
  const current = failed ? failedStep(deployment) : STEPS.findIndex((s) => s.key === deployment.status);

  return (
    <ol className="flex items-center" aria-label="Deployment pipeline">
      {STEPS.map((step, i) => {
        const state =
          failed && i === current
            ? 'failed'
            : i < current || deployment.status === 'ready'
              ? 'done'
              : i === current && !failed
                ? 'active'
                : 'pending';
        const Icon = state === 'done' ? Check : state === 'failed' ? X : step.icon;
        return (
          <li key={step.key} className={cn('flex items-center', i < STEPS.length - 1 && 'flex-1')}>
            <div className="flex flex-col items-center gap-2">
              <span
                className={cn(
                  'relative grid size-9 place-items-center rounded-full border transition-all duration-300',
                  state === 'done' && 'border-success/40 bg-success-soft text-success',
                  state === 'active' && 'border-accent bg-accent-soft text-accent',
                  state === 'failed' && 'border-danger/50 bg-danger-soft text-danger',
                  state === 'pending' && 'border-line bg-bg text-subtle',
                )}
              >
                {state === 'active' && (
                  <span className="absolute inset-[-4px] animate-spin rounded-full border-2 border-transparent border-t-accent [animation-duration:1.2s]" />
                )}
                <Icon className="size-4" />
              </span>
              <span
                className={cn(
                  'text-xs font-medium',
                  state === 'pending' ? 'text-subtle' : state === 'failed' ? 'text-danger' : 'text-fg',
                )}
              >
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="mx-2 mb-6 h-px flex-1 overflow-hidden bg-line">
                <div
                  className={cn(
                    'h-full bg-success transition-all duration-500',
                    i < current || deployment.status === 'ready' ? 'w-full' : 'w-0',
                  )}
                />
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

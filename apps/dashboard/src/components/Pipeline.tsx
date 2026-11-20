'use client';

/** Deployment pipeline steps (Clone → Queue → Build → Upload → Live), shown live on the build page. */

import { GitBranch, Hammer, Inbox, Rocket, UploadCloud, type LucideIcon } from 'lucide-react';
import type { Deployment, DeploymentStatus } from '@deployx/shared/types';

export const STEPS: { key: DeploymentStatus; label: string; icon: LucideIcon }[] = [
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

export type StepState = 'pending' | 'active' | 'done' | 'failed' | 'stopped';

/** State of each pipeline step (same order as STEPS). A stopped/failed deployment ends at the step it reached. */
export function stepStates(d: Deployment): StepState[] {
  const stopped = d.status === 'cancelled';
  const failed = d.status === 'failed' || stopped;
  const current = failed ? failedStep(d) : STEPS.findIndex((s) => s.key === d.status);
  return STEPS.map((_, i) =>
    failed && i === current
      ? stopped
        ? 'stopped'
        : 'failed'
      : i < current || d.status === 'ready'
        ? 'done'
        : i === current && !failed
          ? 'active'
          : 'pending',
  );
}

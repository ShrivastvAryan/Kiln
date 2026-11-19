'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { startGitHubConnect, useGitHubStatus } from '@/hooks/github';
import { Button, GitHubIcon, useToast } from './ui';

const DISMISS_KEY = 'kiln-github-card-dismissed';

/** Post-login prompt on the Deployments page for users who haven't connected GitHub yet. */
export function GitHubConnectCard() {
  const { status } = useGitHubStatus();
  const toast = useToast();
  const [dismissed, setDismissed] = useState(true); // assume dismissed until storage is read (no flash)
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!status?.configured || status.connected || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage unavailable: hidden for this visit only */
    }
  };

  return (
    <div className="relative mb-8 flex animate-slide-up flex-col gap-4 overflow-hidden rounded-xl border border-line bg-surface p-5 sm:flex-row sm:items-center">
      <div
        className="pointer-events-none absolute inset-y-0 right-0 w-1/2 opacity-60"
        aria-hidden="true"
        style={{ background: 'radial-gradient(ellipse 70% 120% at 100% 50%, var(--dx-accent-soft), transparent 70%)' }}
      />
      <span className="relative grid size-12 shrink-0 place-items-center rounded-xl bg-fg text-bg">
        <GitHubIcon className="size-6" />
      </span>
      <div className="relative min-w-0 flex-1">
        <h2 className="font-medium">Connect your GitHub</h2>
        <p className="mt-1 text-sm text-muted">Import repositories in one click instead of pasting URLs.</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle">
          {['You choose which repos', 'Read-only access', 'Disconnect anytime'].map((t) => (
            <li key={t} className="inline-flex items-center gap-1">
              <Check className="size-3.5 text-success" /> {t}
            </li>
          ))}
        </ul>
      </div>
      <Button
        variant="primary"
        loading={busy}
        className="relative shrink-0"
        onClick={async () => {
          setBusy(true);
          try {
            await startGitHubConnect('/new');
          } catch (e) {
            toast({ tone: 'error', title: 'Could not start GitHub connection', description: (e as Error).message });
            setBusy(false);
          }
        }}
      >
        Connect GitHub <ArrowRight className="size-4" />
      </Button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute top-3 right-3 grid size-7 place-items-center rounded-md text-subtle hover:bg-hover hover:text-fg cursor-pointer"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

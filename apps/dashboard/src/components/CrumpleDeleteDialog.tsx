'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Hand, Trash2 } from 'lucide-react';
import type { Deployment } from '@deployx/shared/types';
import PaperCrumple, { type PaperCrumpleState } from '@/components/react-bits/PaperCrumple';
import { displayUrl } from '@/lib/format';
import { RECEIPT, RECEIPT_PAPER, hashString, makeReceipt } from '@/lib/receipt';
import { Button } from './ui';

/** How long the receipt must be held before the deployment is deleted. */
const HOLD_MS = 1300;
/** Time for the crumpled ball to be tossed before the delete request goes out. */
const TOSS_MS = 700;

type Phase = 'idle' | 'holding' | 'tossing';

/**
 * Delete confirmation where the deployment is a paper receipt: press and hold to crumple it, keep
 * holding and it's tossed and the deployment deleted; let go early and it smooths back out.
 * The plain "Delete" button stays for keyboard users, reduced motion, and browsers without WebGL.
 */
export function CrumpleDeleteDialog({
  open,
  deployment: d,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  deployment: Deployment;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  const [receipt, setReceipt] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [paperFailed, setPaperFailed] = useState(false);
  const phaseRef = useRef<Phase>('idle');
  const holdTimer = useRef<number | undefined>(undefined);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  // Fresh receipt and state each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    go('idle');
    setPaperFailed(false);
    let alive = true;
    makeReceipt(d)
      .then((url) => alive && setReceipt(url))
      .catch(() => alive && setPaperFailed(true));
    cancelRef.current?.focus();
    return () => {
      alive = false;
      window.clearTimeout(holdTimer.current);
    };
  }, [open, d.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && phaseRef.current !== 'tossing' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  const onPaperState = (state: PaperCrumpleState) => {
    if (phaseRef.current === 'tossing') return;
    if (state === 'holding') {
      go('holding');
      holdTimer.current = window.setTimeout(() => {
        // Freeze the wad (releaseBehavior → "stay", input disabled), toss it, then delete.
        go('tossing');
        window.setTimeout(() => void onConfirm(), TOSS_MS);
      }, HOLD_MS);
    } else {
      window.clearTimeout(holdTimer.current);
      go('idle');
    }
  };

  const tossing = phase === 'tossing';

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !tossing && !busy && onClose()}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="crumple-title"
            aria-describedby="crumple-desc"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.2, 0.9, 0.3, 1] }}
            className="relative w-full max-w-md overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
          >
            <div className="px-6 pt-6">
              <h2 id="crumple-title" className="text-base font-semibold">
                Delete this deployment?
              </h2>
              <p id="crumple-desc" className="mt-2 text-sm text-muted">
                <span className="font-mono text-fg">{displayUrl(d.url)}</span> will stop serving immediately and its
                source, build output and logs will be permanently removed.
              </p>
            </div>

            {/* Stage */}
            <div className="relative mt-2">
              <motion.div
                animate={
                  tossing
                    ? { y: 150, scale: 0.3, rotate: -40, opacity: 0 }
                    : { y: 0, scale: 1, rotate: 0, opacity: 1 }
                }
                transition={
                  tossing ? { duration: TOSS_MS / 1000, ease: [0.5, 0, 0.75, 0], delay: 0.15 } : { duration: 0.3 }
                }
              >
                {receipt && !paperFailed ? (
                  <PaperCrumple
                    src={receipt}
                    alt={`Receipt for ${d.id}`}
                    width={RECEIPT.width}
                    height={RECEIPT.height}
                    sceneHeight={300}
                    releaseBehavior={tossing ? 'stay' : 'restore'}
                    crumpleAmount={0.95}
                    crumpleDuration={HOLD_MS / 1000}
                    releaseDuration={0.45}
                    foldCount={8}
                    wrinkleDepth={0.8}
                    paperColor={RECEIPT_PAPER}
                    shadowOpacity={0.25}
                    draggable={false}
                    seed={hashString(d.id) % 1000}
                    disabled={tossing || busy}
                    onStateChange={onPaperState}
                    onError={() => setPaperFailed(true)}
                  />
                ) : (
                  <div className="grid h-[300px] place-items-center">
                    {!paperFailed && <span className="size-5 animate-spin rounded-full border-2 border-line border-t-accent" />}
                    {paperFailed && (
                      <Trash2 className="size-10 text-subtle" aria-hidden="true" />
                    )}
                  </div>
                )}
              </motion.div>

              {/* Hold progress */}
              <div className="mx-auto h-1 w-40 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
                <motion.div
                  className="h-full rounded-full bg-danger"
                  initial={false}
                  animate={{ width: phase === 'idle' ? '0%' : '100%' }}
                  transition={
                    phase === 'holding' ? { duration: HOLD_MS / 1000, ease: 'linear' } : { duration: phase === 'idle' ? 0.25 : 0 }
                  }
                />
              </div>
              <p className="mt-2.5 text-center text-xs text-subtle" aria-live="polite">
                {paperFailed ? (
                  'Use the button below to delete.'
                ) : tossing || busy ? (
                  <span className="text-danger">Deleting…</span>
                ) : phase === 'holding' ? (
                  'Keep holding…'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <Hand className="size-3.5" /> Press and hold the receipt to crumple it
                  </span>
                )}
              </p>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2 border-t border-line bg-bg/40 px-6 py-3">
              <Button ref={cancelRef} variant="ghost" onClick={onClose} disabled={tossing || busy}>
                Cancel
              </Button>
              <Button
                variant={paperFailed ? 'danger' : 'secondary'}
                onClick={() => void onConfirm()}
                loading={busy && !tossing}
                disabled={tossing}
                icon={<Trash2 className="size-4" />}
              >
                {paperFailed ? 'Delete deployment' : 'Just delete'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

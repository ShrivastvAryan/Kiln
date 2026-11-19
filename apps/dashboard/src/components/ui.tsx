'use client';

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { Check, CheckCircle2, Copy, Loader2, X, XCircle } from 'lucide-react';
import type { DeploymentStatus } from '@deployx/shared/types';
import { useCopy } from '@/hooks/misc';
import { cn } from '@/lib/format';

// ── Button ────────────────────────────────────────────────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-fg text-bg hover:opacity-90 shadow-sm',
  secondary: 'bg-surface text-fg border border-line hover:bg-hover hover:border-line-strong',
  ghost: 'text-muted hover:text-fg hover:bg-hover',
  danger: 'bg-danger text-white hover:opacity-90',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }
>(({ variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...props }, ref) => (
  <button
    ref={ref}
    disabled={disabled || loading}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-all',
      'disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] cursor-pointer',
      size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-9 px-4 text-sm',
      VARIANTS[variant],
      className,
    )}
    {...props}
  >
    {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
    {children}
  </button>
));

// ── Inputs ────────────────────────────────────────────────────────────────────

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode; invalid?: boolean }
>(({ icon, invalid, className, ...props }, ref) => (
  <div className="relative">
    {icon && <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle">{icon}</span>}
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-lg border bg-bg px-3 text-sm text-fg placeholder:text-subtle transition-colors',
        'focus:border-accent focus:ring-4 focus:ring-accent-soft focus:outline-none',
        invalid ? 'border-danger' : 'border-line hover:border-line-strong',
        !!icon && 'pl-9',
        className,
      )}
      {...props}
    />
  </div>
));

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-fg">
        {label}
      </label>
      {children}
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-danger" role="alert">
          <XCircle className="size-3.5" /> {error}
        </p>
      ) : (
        hint && <p className="text-xs text-subtle">{hint}</p>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-elevated px-1 font-mono text-[11px] text-subtle">
      {children}
    </kbd>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-line bg-surface', className)}>{children}</div>;
}

// ── Status ────────────────────────────────────────────────────────────────────

export const STATUS_META: Record<DeploymentStatus, { label: string; tone: string; dot: string; active: boolean }> = {
  cloning: { label: 'Cloning', tone: 'text-info bg-info-soft', dot: 'bg-info', active: true },
  queued: { label: 'Queued', tone: 'text-muted bg-elevated', dot: 'bg-subtle', active: true },
  building: { label: 'Building', tone: 'text-warning bg-warning-soft', dot: 'bg-warning', active: true },
  uploading: { label: 'Uploading', tone: 'text-info bg-info-soft', dot: 'bg-info', active: true },
  ready: { label: 'Ready', tone: 'text-success bg-success-soft', dot: 'bg-success', active: false },
  failed: { label: 'Failed', tone: 'text-danger bg-danger-soft', dot: 'bg-danger', active: false },
  cancelled: { label: 'Stopped', tone: 'text-muted bg-elevated', dot: 'bg-subtle', active: false },
};

const PAUSED_META = { label: 'Paused', tone: 'text-warning bg-warning-soft', dot: 'bg-warning', active: false };

export function StatusDot({
  status,
  paused,
  className,
}: {
  status: DeploymentStatus;
  /** A ready deployment that is paused shows as "Paused". */
  paused?: boolean;
  className?: string;
}) {
  const meta = paused && status === 'ready' ? PAUSED_META : STATUS_META[status];
  return (
    <span className={cn('relative inline-flex size-2 shrink-0', className)}>
      {meta.active && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', meta.dot)} />}
      <span className={cn('relative inline-flex size-2 rounded-full', meta.dot)} />
    </span>
  );
}

export function StatusBadge({ status, paused }: { status: DeploymentStatus; paused?: boolean }) {
  const meta = paused && status === 'ready' ? PAUSED_META : STATUS_META[status];
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium', meta.tone)}
    >
      <StatusDot status={status} paused={paused} />
      {meta.label}
    </span>
  );
}

// ── Copy ──────────────────────────────────────────────────────────────────────

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => copy(value)}
      aria-label={label}
      title={copied ? 'Copied!' : label}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md text-subtle transition-colors hover:bg-hover hover:text-fg cursor-pointer',
        className,
      )}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

// ── Dialog ────────────────────────────────────────────────────────────────────

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className="relative w-full max-w-md animate-slide-up rounded-xl border border-line bg-surface p-6 shadow-2xl"
      >
        <h2 id="dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        {description && <div className="mt-2 text-sm text-muted">{description}</div>}
        <div className="mt-6 flex justify-end gap-2">{children}</div>
      </div>
    </div>
  );
}

// ── Toasts ────────────────────────────────────────────────────────────────────

interface Toast {
  id: number;
  title: string;
  description?: string;
  tone: 'success' | 'error';
}

const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex animate-slide-up items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-xl"
          >
            {t.tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t.title}</p>
              {t.description && <p className="mt-0.5 text-[13px] break-words text-muted">{t.description}</p>}
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-subtle hover:text-fg cursor-pointer"
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

// ── Misc ──────────────────────────────────────────────────────────────────────

export function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, Eye, EyeOff, Lock, Mail, User } from 'lucide-react';
import { useSession } from '@/hooks/auth';
import { ApiError } from '@/lib/http';
import { fetchProviders, googleSignInUrl, safeNext, signIn, signUp } from '@/lib/session';
import { Button, Field, Input } from './ui';

const OAUTH_ERRORS: Record<string, string> = {
  google_unavailable: 'Google sign-in isn’t configured on this server yet. Use email and password.',
  google_denied: 'Google sign-in was cancelled.',
  google_state: 'That sign-in attempt expired. Please try again.',
  google_failed: 'Google sign-in failed. Please try again.',
};

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.56-5.17 3.56-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.9l-3.88-3.02c-1.07.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.71-4.95H1.28v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.28A7.2 7.2 0 0 1 4.91 12c0-.79.14-1.56.38-2.28V6.61H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4.01 3.11C6.23 6.88 8.88 4.77 12 4.77Z" />
    </svg>
  );
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const { status } = useSession();
  const [google, setGoogle] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(OAUTH_ERRORS[params.get('error') ?? ''] ?? null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const firstField = useRef<HTMLInputElement>(null);
  const isLogin = mode === 'login';

  useEffect(() => {
    void fetchProviders().then((p) => setGoogle(p.google));
    firstField.current?.focus();
  }, []);

  // Already signed in (e.g. opened /login in a second tab): go straight on.
  useEffect(() => {
    if (status === 'authenticated') router.replace(next);
  }, [status, next, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    const local: Record<string, string> = {};
    if (!isLogin && !name.trim()) local.name = 'Enter your name';
    if (!email.trim()) local.email = 'Enter your email';
    if (!password) local.password = 'Enter your password';
    else if (!isLogin && password.length < 8) local.password = 'Use at least 8 characters';
    if (Object.keys(local).length) return setFieldErrors(local);

    setSubmitting(true);
    try {
      if (isLogin) await signIn(email, password);
      else await signUp(name, email, password);
      router.replace(next);
    } catch (err) {
      const e = err as ApiError;
      if (e.field) setFieldErrors({ [e.field]: e.message });
      else setError(e.message);
      setSubmitting(false);
    }
  };

  const switchHref = `${isLogin ? '/register' : '/login'}${next !== '/deployments' ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <div className="w-full max-w-sm animate-slide-up">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{isLogin ? 'Welcome back' : 'Create your account'}</h1>
        <p className="mt-2 text-sm text-muted">
          {isLogin ? 'Sign in to manage your deployments.' : 'Deploy any Git repo in seconds.'}
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-6 shadow-2xl shadow-black/20">
        {google && (
          <>
            <a
              href={googleSignInUrl(next)}
              className="flex h-10 w-full items-center justify-center gap-3 rounded-lg border border-line bg-bg text-sm font-medium transition-colors hover:border-line-strong hover:bg-hover"
            >
              <GoogleLogo className="size-4" /> Continue with Google
            </a>
            <div className="my-5 flex items-center gap-3 text-xs text-subtle">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        {error && (
          <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4" noValidate>
          {!isLogin && (
            <Field label="Name" htmlFor="name" error={fieldErrors.name}>
              <Input
                id="name"
                ref={firstField}
                icon={<User className="size-4" />}
                autoComplete="name"
                placeholder="Ada Lovelace"
                value={name}
                invalid={!!fieldErrors.name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
          )}
          <Field label="Email" htmlFor="email" error={fieldErrors.email}>
            <Input
              id="email"
              ref={isLogin ? firstField : undefined}
              type="email"
              icon={<Mail className="size-4" />}
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              invalid={!!fieldErrors.email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            error={fieldErrors.password}
            hint={isLogin ? undefined : 'At least 8 characters.'}
          >
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                icon={<Lock className="size-4" />}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                placeholder="••••••••"
                value={password}
                invalid={!!fieldErrors.password}
                onChange={(e) => setPassword(e.target.value)}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-subtle hover:text-fg cursor-pointer"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Button type="submit" variant="primary" loading={submitting} className="w-full">
            {isLogin ? 'Sign in' : 'Create account'}
          </Button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-muted">
        {isLogin ? 'New to Kiln? ' : 'Already have an account? '}
        <Link href={switchHref} className="font-medium text-accent hover:underline">
          {isLogin ? 'Create an account' : 'Sign in'}
        </Link>
      </p>
    </div>
  );
}

import type { ReactNode } from 'react';
import { HeroBackground } from '@/components/HeroBackground';
import { Logo } from '@/components/Layout';

/**
 * Sign-in / sign-up screens: no console chrome. Same always-dark stage as the home hero:
 * the animated ASCII sunrise, grid lines, and a scrim that keeps the form readable.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="theme-dark relative isolate flex min-h-screen flex-col overflow-hidden bg-bg text-fg">
      <HeroBackground className="absolute inset-0 -z-30" />
      <div className="bg-grid absolute inset-0 -z-20" aria-hidden="true" />
      {/* Scrim behind the form so the glow never competes with the inputs */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_45%_50%_at_50%_45%,rgb(12_10_9/0.9),transparent_75%)]"
        aria-hidden="true"
      />
      <header className="px-4 py-5 sm:px-8">
        <Logo />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">{children}</main>
    </div>
  );
}

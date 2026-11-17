'use client';

import { useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Globe, Hammer, Link2, Rocket } from 'lucide-react';
import CardSwap, { Card, type CardSwapHandle } from '@/components/react-bits/CardSwap';
import { cn } from '@/lib/format';

/*
 * "How it works": the three steps as a swapping 3D card stack (React Bits CardSwap),
 * with a step list beside it that tracks the front card and can bring any step forward.
 */

interface Step {
  title: string;
  text: string;
  icon: ComponentType<{ className?: string }>;
  visual: ReactNode;
}

function PasteVisual() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-950/80 px-3 py-2.5 font-mono text-[12px] text-neutral-300">
        <Link2 className="size-3.5 shrink-0 text-neutral-500" />
        <span className="truncate">https://github.com/acme/web</span>
        <span className="h-3.5 w-px animate-pulse bg-brand-400" />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-md border border-neutral-800 px-2 py-1 font-mono text-[11px] text-neutral-500">
          branch: main
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-500 px-3 py-1.5 text-xs font-semibold text-neutral-950">
          <Rocket className="size-3.5" /> Deploy
        </span>
      </div>
    </div>
  );
}

function BuildVisual() {
  const lines = [
    { c: 'text-brand-300', t: '› Detected framework: Vite' },
    { c: 'text-neutral-400', t: '$ npm ci && npm run build' },
    { c: 'text-neutral-300', t: 'vite v6 building for production…' },
    { c: 'text-emerald-400', t: '✓ 42 modules transformed' },
  ];
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-3 font-mono text-[11.5px] leading-6">
      {lines.map((l, i) => (
        <div key={i} className={cn('truncate', l.c)}>
          {l.t}
        </div>
      ))}
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full w-3/4 rounded-full bg-brand-500" />
      </div>
    </div>
  );
}

function LiveVisual() {
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950/80">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="size-2 rounded-full bg-emerald-400" />
        <span className="truncate font-mono text-[11.5px] text-neutral-300">k3x9q2.localhost:3001</span>
        <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
          Ready
        </span>
      </div>
      <div className="space-y-2 p-3">
        <div className="h-2.5 w-2/3 rounded bg-neutral-700" />
        <div className="h-2 w-full rounded bg-neutral-800" />
        <div className="h-2 w-5/6 rounded bg-neutral-800" />
        <div className="mt-1 h-5 w-20 rounded bg-brand-500/80" />
      </div>
    </div>
  );
}

const STEPS: Step[] = [
  {
    title: 'Paste a repository',
    text: 'Any public Git URL: GitHub, GitLab or Bitbucket. Branch is optional.',
    icon: Link2,
    visual: <PasteVisual />,
  },
  {
    title: 'We build it',
    text: 'Framework and package manager are detected; the build runs in an isolated worker while logs stream live.',
    icon: Hammer,
    visual: <BuildVisual />,
  },
  {
    title: 'Get a live URL',
    text: 'Every deploy gets its own immutable subdomain, e.g. abc123.localhost:3001.',
    icon: Globe,
    visual: <LiveVisual />,
  },
];

export function HowItWorks() {
  const swap = useRef<CardSwapHandle>(null);
  const [active, setActive] = useState(0);

  /** Swap forward until the chosen step is at the front (the stack only moves one way). */
  const bringToFront = (index: number) => {
    const moves = (index - active + STEPS.length) % STEPS.length;
    for (let i = 0; i < moves; i++) setTimeout(() => swap.current?.next(), i * 140);
  };

  return (
    <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
      {/* Step list: tracks the front card, click to jump */}
      <ol className="space-y-3">
        {STEPS.map(({ title, text, icon: Icon }, i) => {
          const isActive = i === active;
          return (
            <li key={title}>
              <button
                type="button"
                onClick={() => bringToFront(i)}
                aria-current={isActive ? 'step' : undefined}
                className={cn(
                  'flex w-full gap-4 rounded-xl border p-4 text-left transition-all duration-300 cursor-pointer',
                  isActive
                    ? 'border-accent bg-accent-soft'
                    : 'border-line bg-surface opacity-70 hover:border-line-strong hover:opacity-100',
                )}
              >
                <span
                  className={cn(
                    'grid size-10 shrink-0 place-items-center rounded-lg transition-colors',
                    isActive ? 'bg-accent text-accent-fg' : 'bg-elevated text-muted',
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-subtle">0{i + 1}</span>
                    <span className="font-medium">{title}</span>
                  </span>
                  <span className="mt-1 block text-sm text-muted">{text}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {/* The stack */}
      <div className="relative h-[260px] sm:h-[400px]">
        <CardSwap
          ref={swap}
          width={540}
          height={300}
          cardDistance={50}
          verticalDistance={56}
          delay={4500}
          skewAmount={5}
          dim={0.55}
          cardRadius={18}
          theme="dark"
          onChange={setActive}
        >
          {STEPS.map(({ title, text, icon: Icon, visual }, i) => (
            <Card key={title}>
              {/* Our own surface on top of the component's default tile */}
              <div className="absolute inset-0 flex flex-col bg-[linear-gradient(180deg,#1c1917_0%,#0c0a09_100%)] p-5 text-neutral-100">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-500/15 text-brand-400">
                      <Icon className="size-[18px]" />
                    </span>
                    <span className="truncate font-semibold">{title}</span>
                  </span>
                  <span className="font-mono text-xs text-neutral-500">
                    0{i + 1} / 0{STEPS.length}
                  </span>
                </div>
                <div className="mt-4 flex-1">{visual}</div>
                <p className="mt-3 line-clamp-2 text-[13px] leading-snug text-neutral-400">{text}</p>
              </div>
            </Card>
          ))}
        </CardSwap>
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  Cpu,
  Database,
  GitBranch,
  Plus,
  Radio,
  Rocket,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { Logo } from '@/components/Layout';
import { ArchitectureFlow } from '@/components/ArchitectureFlow';
import { HeaderAuthLinks } from '@/components/HeaderAuthLinks';
import { HeroBackground } from '@/components/HeroBackground';
import { HowItWorks } from '@/components/HowItWorks';
import { StackShowcase } from '@/components/StackShowcase';

export const metadata: Metadata = {
  title: { absolute: 'Kiln: deploy any Git repo in seconds' },
  description: 'A local-first deployment platform. Paste a Git URL, watch it build live, get a URL.',
};

/*
 * Onboarding / home page.
 * Intentionally simple placeholder layout: sections are self-contained so they can be
 * restyled or replaced individually later.
 */

const FEATURES = [
  { icon: Radio, title: 'Real-time logs', text: 'Line-by-line build output over Server-Sent Events.' },
  { icon: ShieldCheck, title: 'Sandboxed builds', text: 'Docker containers with CPU, memory and PID limits.' },
  { icon: Cpu, title: 'Worker pool', text: 'Redis-backed queue with concurrent, horizontally scalable workers.' },
  { icon: Boxes, title: 'Zero config', text: 'Vite, Next.js, Astro, SvelteKit, CRA, static HTML and more.' },
  { icon: Database, title: 'Durable history', text: 'Deployments and logs persisted in PostgreSQL.' },
  { icon: GitBranch, title: 'Immutable deploys', text: 'Redeploy or roll back by id; assets are cached forever.' },
];

const FAQ = [
  {
    q: 'What frontend frameworks does Kiln support?',
    a: 'Anything that builds to static files. Vite, Create React App, Next.js (static export), Astro, SvelteKit, Gatsby, Docusaurus and Angular are detected automatically, as are npm, pnpm, yarn and bun lockfiles. Plain HTML sites deploy as-is. You can override the install command, build command and output folder per deployment.',
  },
  {
    q: 'How does the wildcard subdomain routing work?',
    a: 'Every deployment gets a short DNS-safe id. Browsers resolve *.localhost to 127.0.0.1, so http://<id>.localhost:3001 reaches the router without any DNS setup. The router reads the id from the Host header and streams files from dist/<id>/ in object storage, with clean URLs, SPA fallback, ETags and immutable caching for hashed assets.',
  },
  {
    q: 'Can I scale the build workers horizontally?',
    a: 'Yes. Each worker process runs WORKER_CONCURRENCY build slots that block on a shared Redis queue, so you can start as many processes as you like, on one machine or many. Jobs are claimed with a conditional UPDATE in PostgreSQL, so no deployment is ever built twice.',
  },
  {
    q: 'Where are build artifacts stored?',
    a: 'In S3-compatible object storage: SeaweedFS locally, or AWS S3 / Cloudflare R2 by changing the endpoint. Source snapshots live under source/<id>/ and build output under dist/<id>/. A local-disk driver with the same layout works without Docker. Deployment records and build logs are kept in PostgreSQL.',
  },
  {
    q: 'Is it safe to build repositories I don’t control?',
    a: 'By default every install and build runs in a throwaway Docker container with memory, CPU and PID limits and no-new-privileges, as your own user, with a hard timeout. The BUILD_ISOLATION=local mode skips the container and is meant for trusted repositories only.',
  },
];

const DEMO_LOG = [
  { c: 'text-brand-300', t: '› Cloning github.com/acme/web (branch: main)' },
  { c: 'text-brand-300', t: '› Detected framework: Vite' },
  { c: 'text-stone-400', t: '$ npm ci --no-audit --no-fund' },
  { c: 'text-stone-300', t: 'added 214 packages in 6s' },
  { c: 'text-stone-400', t: '$ npm run build' },
  { c: 'text-stone-300', t: 'vite v6.0.7 building for production…' },
  { c: 'text-emerald-400', t: '✓ 42 modules transformed. built in 1.84s' },
  { c: 'text-brand-300', t: '✓ Deployment ready → http://k3x9q2.localhost:3001' },
];

const FOOTER_LINKS = [
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Architecture', href: '#architecture' },
  { label: 'Stack', href: '#stack' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Console', href: '/deployments' },
];

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-semibold tracking-widest text-accent uppercase">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
      {text && <p className="mt-3 text-muted">{text}</p>}
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="flex items-center gap-1 text-sm sm:gap-2">
            <a href="#how-it-works" className="hidden rounded-md px-3 py-2 text-muted hover:text-fg sm:block">
              How it works
            </a>
            <a href="#architecture" className="hidden rounded-md px-3 py-2 text-muted hover:text-fg sm:block">
              Architecture
            </a>
            <a href="#features" className="hidden rounded-md px-3 py-2 text-muted hover:text-fg sm:block">
              Features
            </a>
            <a href="#stack" className="hidden rounded-md px-3 py-2 text-muted hover:text-fg md:block">
              Stack
            </a>
            <HeaderAuthLinks />
          </nav>
        </div>
      </header>

      <main>
        {/* Hero: always-dark stage with an animated ASCII sunrise (React Bits GradientASCII) */}
        <section className="theme-dark relative isolate overflow-hidden bg-neutral-950 text-neutral-100">
          <HeroBackground className="absolute inset-0 -z-30" />
          {/* Grid lines (same as the auth pages), fading out from the top */}
          <div className="bg-grid absolute inset-0 -z-20" aria-hidden="true" />
          {/* Scrim keeps the heading readable over the glow */}
          <div
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_55%_at_50%_30%,rgb(12_10_9/0.85),transparent_75%)]"
            aria-hidden="true"
          />
          <div className="mx-auto flex min-h-[min(780px,88svh)] max-w-4xl flex-col items-center px-4 pt-20 pb-64 text-center sm:px-6 sm:pt-28">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-300 backdrop-blur">
              <span className="size-1.5 rounded-full bg-success" /> Local-first · self-hosted
            </span>
            <h1 className="mt-6 text-5xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
              Deploy any Git repo <span className="text-brand-400">in seconds.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-pretty text-neutral-300">
              Paste a repository URL. Kiln clones it, builds it in an isolated worker, streams every log line to
              your browser and serves it on its own subdomain.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                href="/new"
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-500 px-5 font-medium text-neutral-950 shadow-lg shadow-brand-500/25 transition-colors hover:bg-brand-400"
              >
                <Rocket className="size-4" /> Deploy a repository
              </Link>
              <Link
                href="/deployments"
                className="inline-flex h-11 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-5 font-medium text-neutral-100 backdrop-blur transition-colors hover:bg-white/10"
              >
                View deployments
              </Link>
            </div>
          </div>
        </section>

        {/* Terminal preview, overlapping the bottom of the hero */}
        <div className="relative z-10 mx-auto -mt-28 max-w-3xl px-4 sm:px-6">
          <div className="overflow-hidden rounded-xl border border-stone-800 bg-[#0c0a09]/95 shadow-2xl shadow-black/50 backdrop-blur">
            <div className="flex items-center gap-2 border-b border-stone-800 bg-[#141110] px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-stone-700" />
              <span className="size-2.5 rounded-full bg-stone-700" />
              <span className="size-2.5 rounded-full bg-stone-700" />
              <span className="ml-2 flex items-center gap-1.5 text-xs text-stone-500">
                <Terminal className="size-3.5" /> Build logs
              </span>
            </div>
            <pre className="p-4 font-mono text-[11.5px] leading-6 break-all whitespace-pre-wrap sm:overflow-x-auto sm:text-[12.5px] sm:leading-7 sm:break-normal sm:whitespace-pre">
              {DEMO_LOG.map((l, i) => (
                <div key={i} className={l.c}>
                  <span className="mr-4 inline-block w-4 text-right text-stone-600 select-none">{i + 1}</span>
                  {l.t}
                </div>
              ))}
            </pre>
          </div>
        </div>

        {/* How it works / onboarding steps */}
        <section id="how-it-works" className="scroll-mt-16 py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading eyebrow="How it works" title="From repository to URL in three steps" />
            <div className="mt-12">
              <HowItWorks />
            </div>
          </div>
        </section>

        {/* System architecture (interactive) */}
        <section id="architecture" className="scroll-mt-16 border-t border-line py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="System design"
              title="How the pieces fit together"
              text="Four services, a queue, a database and object storage. Hover or click any component to trace its connections."
            />
            <div className="mt-12">
              <ArchitectureFlow />
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-16 border-t border-line py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Features"
              title="Everything a deployment platform needs"
              text="A queue, isolated builds, live logs, durable history and a router, wired together."
            />
            <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, text }) => (
                <div key={title} className="bg-surface p-6">
                  <Icon className="size-5 text-accent" />
                  <h3 className="mt-4 font-medium">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Tech stack: 3D ring of "element" cards */}
        <section id="stack" className="scroll-mt-16 border-t border-line py-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Stack"
              title="The periodic table of Kiln"
              text="Twelve elements, one platform. Drag the ring to spin through the stack."
            />
            <div className="mt-12">
              <StackShowcase />
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-16 border-t border-line py-20">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <SectionHeading eyebrow="FAQ" title="Questions, ideas or bugs?" />
            <div className="mt-10 divide-y divide-line border-y border-line">
              {FAQ.map(({ q, a }) => (
                <details key={q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-[15px] font-medium transition-colors hover:text-accent [&::-webkit-details-marker]:hidden">
                    {q}
                    <Plus className="size-4 shrink-0 text-subtle transition-transform duration-200 group-open:rotate-45 group-open:text-accent" />
                  </summary>
                  <p className="pr-8 pb-5 text-sm leading-relaxed text-muted">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="border-t border-line py-16">
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 px-4 text-center sm:flex-row sm:justify-between sm:text-left sm:px-6">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Ready to ship something?</h2>
              <p className="mt-1 text-sm text-muted">Paste a repo and get a live URL in under a minute.</p>
            </div>
            <Link
              href="/new"
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-fg px-5 font-medium text-bg transition-opacity hover:opacity-90"
            >
              Create your first deployment <ArrowRight className="size-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm sm:px-6 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden text-xs text-subtle sm:inline">· Local-first deployments</span>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-muted md:justify-center">
            {FOOTER_LINKS.map((l) =>
              l.href.startsWith('/') ? (
                <Link key={l.label} href={l.href} className="transition-colors hover:text-fg">
                  {l.label}
                </Link>
              ) : (
                <a key={l.label} href={l.href} className="transition-colors hover:text-fg">
                  {l.label}
                </a>
              ),
            )}
          </nav>
          <p className="text-xs text-subtle md:text-right">
            © {new Date().getFullYear()} Kiln. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

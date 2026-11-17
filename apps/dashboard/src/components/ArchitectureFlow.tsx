'use client';

import { useMemo, useState, type ComponentType } from 'react';
import { Box, Cpu, Database, Globe, HardDrive, Monitor, Network, UploadCloud, User, Zap } from 'lucide-react';
import { cn } from '@/lib/format';

/*
 * Interactive system-architecture diagram for the home page (hover or click a node to highlight its connections).
 * Layout uses a fixed 1180×700 coordinate space: edges are drawn in an SVG with that viewBox,
 * nodes are HTML buttons positioned in percentages of the same space, so both scale together.
 */

const W = 1180;
const H = 700;
const NODE_W = 220;
const NODE_H = 68;

type NodeId =
  | 'developer'
  | 'console'
  | 'api'
  | 'postgres'
  | 'redis'
  | 'storage'
  | 'visitor'
  | 'router'
  | 'worker'
  | 'container';

interface FlowNode {
  id: NodeId;
  x: number;
  y: number;
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
}

const NODES: FlowNode[] = [
  {
    id: 'developer',
    x: 30,
    y: 40,
    title: 'Developer',
    subtitle: 'Repo owner',
    icon: User,
  },
  {
    id: 'console',
    x: 330,
    y: 40,
    title: 'Next.js Console',
    subtitle: 'Console · :3000',
    icon: Monitor,
  },
  {
    id: 'api',
    x: 630,
    y: 40,
    title: 'API / Uploader',
    subtitle: 'Express · :8000',
    icon: UploadCloud,
  },
  {
    id: 'postgres',
    x: 930,
    y: 40,
    title: 'PostgreSQL',
    subtitle: 'Prisma · Neon',
    icon: Database,
  },
  {
    id: 'redis',
    x: 930,
    y: 230,
    title: 'Redis',
    subtitle: 'Queue · pub/sub',
    icon: Zap,
  },
  {
    id: 'storage',
    x: 930,
    y: 420,
    title: 'Object Storage',
    subtitle: 'MinIO · S3 · R2',
    icon: HardDrive,
  },
  {
    id: 'visitor',
    x: 30,
    y: 420,
    title: 'Visitor',
    subtitle: 'Opens live URL',
    icon: Globe,
  },
  {
    id: 'router',
    x: 330,
    y: 420,
    title: 'Request Router',
    subtitle: 'Wildcard · :3001',
    icon: Network,
  },
  {
    id: 'worker',
    x: 630,
    y: 420,
    title: 'Build Worker',
    subtitle: 'N parallel slots',
    icon: Cpu,
  },
  {
    id: 'container',
    x: 630,
    y: 600,
    title: 'Build Container',
    subtitle: 'Sandboxed build',
    icon: Box,
  },
];

interface FlowEdge {
  id: string;
  from: NodeId;
  to: NodeId;
  d: string;
  label: string;
  lx: number;
  ly: number;
}

const EDGES: FlowEdge[] = [
  { id: 'dev-console', from: 'developer', to: 'console', d: 'M250 74 H330', label: 'repo URL', lx: 290, ly: 62 },
  { id: 'console-api', from: 'console', to: 'api', d: 'M550 62 H630', label: 'POST /deploy', lx: 590, ly: 24 },
  { id: 'api-console', from: 'api', to: 'console', d: 'M630 90 H550', label: 'SSE logs', lx: 590, ly: 124 },
  { id: 'api-postgres', from: 'api', to: 'postgres', d: 'M850 58 H930', label: 'INSERT', lx: 890, ly: 46 },
  { id: 'api-redis', from: 'api', to: 'redis', d: 'M850 74 H880 V256 H930', label: 'LPUSH job', lx: 880, ly: 190 },
  { id: 'api-storage', from: 'api', to: 'storage', d: 'M850 92 H900 V440 H930', label: 'source snapshot', lx: 900, ly: 400 },
  { id: 'redis-worker', from: 'redis', to: 'worker', d: 'M1000 298 V350 H760 V420', label: 'BRPOP', lx: 960, ly: 350 },
  { id: 'worker-redis', from: 'worker', to: 'redis', d: 'M700 420 V320 H1080 V298', label: 'PUBLISH logs', lx: 1080, ly: 320 },
  { id: 'worker-storage', from: 'worker', to: 'storage', d: 'M850 466 H930', label: 'src ↓  dist ↑', lx: 890, ly: 506 },
  { id: 'worker-container', from: 'worker', to: 'container', d: 'M720 488 V600', label: 'docker run', lx: 720, ly: 528 },
  { id: 'container-worker', from: 'container', to: 'worker', d: 'M780 600 V488', label: 'stdout', lx: 780, ly: 572 },
  { id: 'visitor-router', from: 'visitor', to: 'router', d: 'M250 454 H330', label: 'HTTP GET', lx: 290, ly: 440 },
  { id: 'router-storage', from: 'router', to: 'storage', d: 'M440 488 V560 H1040 V488', label: 'fetch dist/<id>/*', lx: 560, ly: 560 },
];

const GROUPS = [
  { label: 'Data layer', x: 915, y: 18, w: 250, h: 488 },
  { label: 'Build worker pool', x: 615, y: 398, w: 250, h: 288 },
  { label: 'Serving', x: 15, y: 398, w: 550, h: 108 },
];

const pct = (v: number, total: number) => `${(v / total) * 100}%`;

export function ArchitectureFlow() {
  const [selected, setSelected] = useState<NodeId>('api');
  const [hovered, setHovered] = useState<NodeId | null>(null);

  // Hover previews a component's connections; click pins the selection.
  const focusNode = hovered ?? selected;
  const { activeEdges, activeNodes } = useMemo(() => {
    const edges = EDGES.filter((e) => e.from === focusNode || e.to === focusNode);
    return {
      activeEdges: new Set(edges.map((e) => e.id)),
      activeNodes: new Set<NodeId>([focusNode, ...edges.flatMap((e) => [e.from, e.to])]),
    };
  }, [focusNode]);

  return (
    <>
      {/* Phones: the same graph as a vertical flow of cards with their outgoing connections */}
      <MobileFlow />

      {/* Tablets and up: the interactive diagram */}
      <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
      <div className="relative min-w-[960px]" style={{ aspectRatio: `${W} / ${H}` }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="absolute inset-0 h-full w-full"
          role="img"
          aria-label="Kiln architecture: console, API, PostgreSQL, Redis, object storage, build workers and the request router"
        >
          <defs>
            <pattern id="arch-dots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" style={{ fill: 'var(--dx-line)' }} />
            </pattern>
            <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--dx-line-strong)' }} />
            </marker>
            <marker id="arch-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" style={{ fill: 'var(--dx-accent)' }} />
            </marker>
          </defs>
          <rect width={W} height={H} fill="url(#arch-dots)" />

          {GROUPS.map((g) => (
            <g key={g.label}>
              <rect
                x={g.x}
                y={g.y}
                width={g.w}
                height={g.h}
                rx={14}
                fill="none"
                strokeDasharray="4 5"
                style={{ stroke: 'var(--dx-line-strong)' }}
              />
              <text x={g.x + 12} y={g.y - 6} className="font-mono" fontSize={11} style={{ fill: 'var(--dx-subtle)' }}>
                {g.label}
              </text>
            </g>
          ))}

          {EDGES.map((e) => {
            const active = activeEdges.has(e.id);
            return (
              <path
                key={e.id}
                d={e.d}
                fill="none"
                strokeWidth={active ? 2 : 1.25}
                strokeDasharray={active ? '6 5' : undefined}
                markerEnd={`url(#${active ? 'arch-arrow-active' : 'arch-arrow'})`}
                className={cn('transition-opacity duration-300', active && 'animate-dash')}
                style={{
                  stroke: active ? 'var(--dx-accent)' : 'var(--dx-line-strong)',
                  opacity: active ? 1 : 0.35,
                }}
              />
            );
          })}

          {EDGES.map((e) => {
            const active = activeEdges.has(e.id);
            const w = e.label.length * 6.7 + 12;
            return (
              <g key={`${e.id}-label`} className="transition-opacity duration-300" style={{ opacity: active ? 1 : 0.35 }}>
                <rect
                  x={e.lx - w / 2}
                  y={e.ly - 9}
                  width={w}
                  height={18}
                  rx={4}
                  style={{ fill: 'var(--dx-surface)', stroke: active ? 'var(--dx-accent)' : 'var(--dx-line)' }}
                />
                <text
                  x={e.lx}
                  y={e.ly + 3.5}
                  textAnchor="middle"
                  className="font-mono"
                  fontSize={11}
                  style={{ fill: active ? 'var(--dx-accent)' : 'var(--dx-muted)' }}
                >
                  {e.label}
                </text>
              </g>
            );
          })}
        </svg>

        {NODES.map((n) => {
          const Icon = n.icon;
          const active = activeNodes.has(n.id);
          const isSelected = selected === n.id;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => setSelected(n.id)}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(n.id)}
              onBlur={() => setHovered(null)}
              aria-pressed={isSelected}
              aria-label={`${n.title}: ${n.subtitle}`}
              className={cn(
                'absolute flex items-center gap-3 rounded-xl border bg-surface px-3 text-left transition-all duration-300 cursor-pointer',
                active ? 'border-accent shadow-lg shadow-black/20' : 'border-line opacity-45 hover:border-line-strong',
                isSelected && 'ring-4 ring-accent-soft',
              )}
              style={{
                left: pct(n.x, W),
                top: pct(n.y, H),
                width: pct(NODE_W, W),
                height: pct(NODE_H, H),
              }}
            >
              <span
                className={cn(
                  'grid size-8 shrink-0 place-items-center rounded-lg transition-colors',
                  active ? 'bg-accent-soft text-accent' : 'bg-elevated text-muted',
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{n.title}</span>
                <span className="block truncate font-mono text-[11px] text-subtle">{n.subtitle}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
    </>
  );
}

/** Order the components the way a deployment flows through them. */
const MOBILE_ORDER: NodeId[] = [
  'developer',
  'console',
  'api',
  'postgres',
  'redis',
  'worker',
  'container',
  'storage',
  'visitor',
  'router',
];

function MobileFlow() {
  const byId = new Map(NODES.map((n) => [n.id, n]));
  return (
    <ol className="relative space-y-3 md:hidden" aria-label="Kiln architecture">
      {/* Spine connecting the cards */}
      <span className="absolute top-6 bottom-6 left-[27px] w-px bg-line" aria-hidden="true" />
      {MOBILE_ORDER.map((id) => {
        const n = byId.get(id)!;
        const Icon = n.icon;
        const outgoing = EDGES.filter((e) => e.from === id);
        return (
          <li key={id} className="relative rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center gap-3">
              <span className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{n.title}</span>
                <span className="block font-mono text-[11px] text-subtle">{n.subtitle}</span>
              </span>
            </div>
            {outgoing.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-line pt-3 pl-11">
                {outgoing.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="text-accent" aria-hidden="true">
                      →
                    </span>
                    <span className="text-muted">{byId.get(e.to)!.title}</span>
                    <span className="rounded border border-line bg-elevated px-1.5 py-px font-mono text-[11px] text-subtle">
                      {e.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

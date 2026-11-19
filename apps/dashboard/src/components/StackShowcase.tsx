'use client';

import { MousePointer2 } from 'lucide-react';
import CircularCarousel from '@/components/react-bits/CircularCarousel';
import { brand, neutral } from '@/theme/palette';

/*
 * "Periodic table of the stack": every technology is an element card on a 3D ring
 * (React Bits CircularCarousel).
 * Cards are generated SVGs (data URIs), so there are no image files or external requests.
 */

type Category = 'frontend' | 'language' | 'backend' | 'data' | 'infra';

interface Tech {
  symbol: string;
  name: string;
  role: string;
  category: Category;
}

const STACK: Tech[] = [
  { symbol: 'Nx', name: 'Next.js', role: 'Console framework', category: 'frontend' },
  { symbol: 'Re', name: 'React 19', role: 'UI library', category: 'frontend' },
  { symbol: 'Tw', name: 'Tailwind CSS', role: 'Design tokens', category: 'frontend' },
  { symbol: 'Ts', name: 'TypeScript', role: 'End-to-end types', category: 'language' },
  { symbol: 'No', name: 'Node.js', role: 'Service runtime', category: 'backend' },
  { symbol: 'Ex', name: 'Express', role: 'REST + SSE API', category: 'backend' },
  { symbol: 'Pg', name: 'PostgreSQL', role: 'Source of truth', category: 'data' },
  { symbol: 'Pr', name: 'Prisma', role: 'ORM + migrations', category: 'data' },
  { symbol: 'Rd', name: 'Redis', role: 'Queue + pub/sub', category: 'data' },
  { symbol: 'S3', name: 'SeaweedFS / S3', role: 'Object storage', category: 'data' },
  { symbol: 'Dk', name: 'Docker', role: 'Sandboxed builds', category: 'infra' },
  { symbol: 'Ne', name: 'Neon', role: 'Hosted Postgres', category: 'infra' },
];

const ACCENT: Record<Category, string> = {
  frontend: brand[300],
  language: brand[200],
  backend: brand[400],
  data: brand[500],
  infra: brand[600],
};

const SANS = "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function elementCard(t: Tech, index: number) {
  const a = ACCENT[t.category];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="560" viewBox="0 0 440 560">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${neutral[900]}"/><stop offset="1" stop-color="${neutral[950]}"/></linearGradient>
<radialGradient id="glow" cx="50%" cy="40%" r="55%"><stop offset="0" stop-color="${a}" stop-opacity="0.22"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
<pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.2" fill="${neutral[800]}"/></pattern>
</defs>
<rect width="440" height="560" fill="url(#bg)"/>
<rect width="440" height="560" fill="url(#dots)"/>
<rect width="440" height="560" fill="url(#glow)"/>
<rect x="2" y="2" width="436" height="556" rx="26" fill="none" stroke="${neutral[700]}" stroke-width="3"/>
<text x="34" y="62" font-family="${MONO}" font-size="26" font-weight="600" fill="${a}">${String(index + 1).padStart(2, '0')}</text>
<text x="406" y="60" text-anchor="end" font-family="${MONO}" font-size="17" letter-spacing="3" fill="${neutral[400]}">${t.category.toUpperCase()}</text>
<text x="220" y="300" text-anchor="middle" font-family="${SANS}" font-size="156" font-weight="700" letter-spacing="-6" fill="${a}">${t.symbol}</text>
<line x1="34" y1="392" x2="406" y2="392" stroke="${neutral[800]}" stroke-width="2"/>
<text x="34" y="452" font-family="${SANS}" font-size="40" font-weight="600" fill="${neutral[100]}">${t.name}</text>
<text x="34" y="498" font-family="${MONO}" font-size="21" fill="${neutral[400]}">${t.role}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const ITEMS = STACK.map((t, i) => ({ src: elementCard(t, i), alt: `${t.name}: ${t.role}`, title: t.name, subtitle: t.role }));

export function StackShowcase() {
  return (
    // Always on a dark stage so the cards' depth fade blends into the background.
    <div className="relative h-[300px] overflow-hidden rounded-2xl border border-line bg-neutral-950 sm:h-[520px]">
      <CircularCarousel
        items={ITEMS}
        preset="cylinder"
        intro="rise"
        cardWidth={200}
        aspectRatio={440 / 560}
        gap={22}
        speed={12}
        depthFade={0.75}
        fadeColor={neutral[950]}
        cornerRadius={14}
        parallax={0.4}
      />
      <p className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 text-xs whitespace-nowrap text-neutral-500">
        <MousePointer2 className="size-3.5" /> Drag, scroll sideways or click a card
      </p>
    </div>
  );
}

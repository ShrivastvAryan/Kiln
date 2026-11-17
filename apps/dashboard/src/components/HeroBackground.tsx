'use client';

import { useEffect, useState } from 'react';
import GradientASCII from '@/components/react-bits/GradientASCII';
import { brand } from '@/theme/palette';

/** Light ramp from the edge of the shadow to the brightest point, all from the brand palette. */
const SUNSET = [brand[900], brand[700], brand[500], brand[300], brand[100]];
const FALLBACK_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/**
 * Animated ASCII "sunrise" behind the home page hero (React Bits GradientASCII, WebGL2).
 * Purely decorative: hidden from assistive tech, and the component itself respects
 * prefers-reduced-motion. Browsers without WebGL2 just see the dark hero background.
 */
export function HeroBackground({ className }: { className?: string }) {
  // next/font serves JetBrains Mono under a hashed family name; read it from the CSS variable so the
  // glyph atlas (drawn on a 2D canvas, which can't resolve var()) uses the same font as the UI.
  const [font, setFont] = useState<string | null>(null);
  useEffect(() => {
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-mono-family').trim();
    setFont(family ? `${family}, ${FALLBACK_FONT}` : FALLBACK_FONT);
  }, []);

  return (
    <div className={className} aria-hidden="true">
      {/* Static sunrise glow: shows through the ASCII layer, and is the whole effect where WebGL2 is unavailable. */}
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 85% 70% at 50% 104%, ${brand[500]}66 0%, ${brand[700]}33 42%, transparent 74%)`,
        }}
      />
      {font && (
        <GradientASCII
          colors={SUNSET}
          shape="rise"
          characters=" .:=+xX$#@"
          cellSize={16}
          density={0.75}
          glyphOpacity={0.8}
          gradientOpacity={0.75}
          glow={0.35}
          flicker={0.2}
          softness={0.6}
          scale={1.45}
          flow={0.6}
          speed={0.8}
          grain={0.06}
          clickEffect="wave"
          fontFamily={font}
          style={{ position: 'absolute', inset: 0 }}
        />
      )}
    </div>
  );
}

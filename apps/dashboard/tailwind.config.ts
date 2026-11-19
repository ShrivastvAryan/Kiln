import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';
import { brand, neutral } from './src/theme/palette';

export { brand, neutral };

/**
 * Kiln colour system: "Sunset orange".
 *
 * This file is the single source of truth for colour. It defines:
 *   1. Raw palettes:   `brand` (orange) and `neutral` (warm stone grays), usable as `bg-brand-500` etc.
 *   2. Semantic tokens: `bg`, `surface`, `fg`, `accent`, `success`… for dark and light mode.
 *   3. A plugin that writes the semantic tokens as CSS variables (`--dx-*`) on :root, swapped by
 *      `data-theme="light"` on <html>. Components only use semantic classes (`bg-surface`,
 *      `text-muted`, `bg-accent`…), so re-theming the whole app means editing this file only.
 *
 * Loaded from src/app/globals.css via `@config`.
 */

// ── 1. Raw palettes (src/theme/palette.ts) + status colours ──────────────────

/** Status colours, picked to stay distinct from the orange accent (yellow, not amber, for warnings). */
const status = {
  success: { dark: '#22c55e', light: '#16a34a' },
  warning: { dark: '#eab308', light: '#ca8a04' },
  danger: { dark: '#f43f5e', light: '#e11d48' },
  info: { dark: '#3b82f6', light: '#2563eb' },
} as const;

const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${a})`;
};

// ── 2. Semantic tokens ────────────────────────────────────────────────────────

type Mode = 'dark' | 'light';

const semantic = (mode: Mode) => {
  const dark = mode === 'dark';
  const accent = dark ? brand[500] : brand[600];
  const s = (k: keyof typeof status) => status[k][mode];
  return {
    // surfaces (page → raised)
    bg: dark ? neutral[950] : neutral[50],
    surface: dark ? neutral[925] : neutral[0],
    elevated: dark ? neutral[900] : neutral[100],
    hover: dark ? neutral[850] : neutral[150],
    // borders
    line: dark ? neutral[800] : neutral[200],
    'line-strong': dark ? neutral[750] : neutral[300],
    // text
    fg: dark ? neutral[100] : neutral[900],
    muted: dark ? neutral[400] : neutral[600],
    subtle: dark ? neutral[500] : '#8a837e',
    // brand
    accent,
    'accent-soft': alpha(accent, dark ? 0.14 : 0.1),
    // Dark text on bright orange reads better than white in dark mode.
    'accent-fg': dark ? neutral[950] : '#ffffff',
    // status (+ soft tints for badges)
    success: s('success'),
    'success-soft': alpha(s('success'), 0.12),
    warning: s('warning'),
    'warning-soft': alpha(s('warning'), 0.14),
    danger: s('danger'),
    'danger-soft': alpha(s('danger'), 0.12),
    info: s('info'),
    'info-soft': alpha(s('info'), 0.12),
  };
};

export const tokens = { dark: semantic('dark'), light: semantic('light') };
type TokenName = keyof ReturnType<typeof semantic>;

const cssVars = (mode: Mode) =>
  Object.fromEntries(Object.entries(tokens[mode]).map(([name, value]) => [`--dx-${name}`, value]));

/** Tailwind colour entries pointing at the CSS variables, e.g. `surface: 'var(--dx-surface)'`. */
const semanticColors = Object.fromEntries(
  (Object.keys(tokens.dark) as TokenName[]).map((name) => [name, `var(--dx-${name})`]),
) as Record<TokenName, string>;

// ── 3. Config ─────────────────────────────────────────────────────────────────

const config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand,
        neutral,
        ...semanticColors,
      },
      fontFamily: {
        sans: ['var(--font-sans-family)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['var(--font-mono-family)', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        ':root': { ...cssVars('dark'), colorScheme: 'dark' },
        ':root[data-theme="light"]': { ...cssVars('light'), colorScheme: 'light' },
        // Pin the dark palette for one section (e.g. always-dark hero / auth stage), whatever the page theme.
        '.theme-dark': { ...cssVars('dark'), colorScheme: 'dark' },
      });
    }),
  ],
} satisfies Config;

export default config;

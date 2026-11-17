/**
 * Raw colour palettes for Kiln ("Sunset orange").
 * Shared by tailwind.config.ts (utility classes + CSS variables) and by components that need
 * literal colour values, e.g. the WebGL hero background.
 */

export const brand = {
  50: '#fff7ed',
  100: '#ffedd5',
  200: '#fed7aa',
  300: '#fdba74',
  400: '#fb923c',
  500: '#f97316',
  600: '#ea580c',
  700: '#c2410c',
  800: '#9a3412',
  900: '#7c2d12',
  950: '#431407',
} as const;

/** Warm "stone" grays: pair naturally with orange (cool grays look dull next to it). */
export const neutral = {
  0: '#ffffff',
  50: '#fafaf9',
  100: '#f5f5f4',
  150: '#efedec',
  200: '#e7e5e4',
  300: '#d6d3d1',
  400: '#a8a29e',
  500: '#78716c',
  600: '#57534e',
  700: '#44403c',
  750: '#37322f',
  800: '#292524',
  850: '#211d1b',
  900: '#1c1917',
  925: '#151210',
  950: '#0c0a09',
} as const;

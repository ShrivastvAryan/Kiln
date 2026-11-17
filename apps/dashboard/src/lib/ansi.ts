export interface AnsiSegment {
  text: string;
  color?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
}

// Tuned for the console's dark background.
const COLORS: Record<number, string> = {
  30: '#71717a', 31: '#fb7185', 32: '#4ade80', 33: '#fbbf24',
  34: '#60a5fa', 35: '#c084fc', 36: '#22d3ee', 37: '#e4e4e7',
  90: '#8b8b95', 91: '#fda4af', 92: '#86efac', 93: '#fde68a',
  94: '#93c5fd', 95: '#d8b4fe', 96: '#67e8f9', 97: '#fafafa',
};

// eslint-disable-next-line no-control-regex
const ESCAPE_RE = /\x1b\[([0-9;?]*)([A-Za-z])/g;

/** Converts a line containing ANSI SGR escape codes into styled segments. */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let state: Omit<AnsiSegment, 'text'> = {};
  let last = 0;
  let match: RegExpExecArray | null;
  ESCAPE_RE.lastIndex = 0;

  while ((match = ESCAPE_RE.exec(input))) {
    if (match.index > last) segments.push({ text: input.slice(last, match.index), ...state });
    last = ESCAPE_RE.lastIndex;
    if (match[2] !== 'm') continue; // ignore cursor movement etc.
    const codes = match[1] ? match[1].split(';').map(Number) : [0];
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) state = {};
      else if (c === 1) state = { ...state, bold: true };
      else if (c === 2) state = { ...state, dim: true };
      else if (c === 4) state = { ...state, underline: true };
      else if (c === 22) state = { ...state, bold: false, dim: false };
      else if (c === 24) state = { ...state, underline: false };
      else if (c === 39) state = { ...state, color: undefined };
      else if (COLORS[c]) state = { ...state, color: COLORS[c] };
      else if (c === 38 && codes[i + 1] === 5) i += 2; // 256-colour: skip
      else if (c === 38 && codes[i + 1] === 2) i += 4; // truecolour: skip
    }
  }
  if (last < input.length) segments.push({ text: input.slice(last), ...state });
  return segments;
}

export function stripAnsi(input: string) {
  return input.replace(ESCAPE_RE, '');
}

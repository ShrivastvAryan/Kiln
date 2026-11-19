import type { Deployment } from '@deployx/shared/types';
import { brand } from '@/theme/palette';
import { displayUrl, formatBytes, repoName } from './format';

/** Paper size of the receipt in CSS px (drawn at 2x for a crisp texture). */
export const RECEIPT = { width: 300, height: 400 } as const;
export const RECEIPT_PAPER = '#f5f0e6';

const INK = '#2a2622';
const FADED = '#8a8178';
const FALLBACK_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const FALLBACK_SANS = 'ui-sans-serif, system-ui, sans-serif';

/** The Kiln "< ↑ >" mark, same paths as icon.svg (24-unit grid). */
const LOGO_PATHS = ['M7 7.25 2.25 12 7 16.75', 'M17 7.25 21.75 12 17 16.75', 'M12 18V6.25', 'm9.25 9 2.75-2.75L14.75 9'];

/** Small stable hash, used to seed the barcode and the crumple folds. */
export function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function dashedRule(ctx: CanvasRenderingContext2D, y: number, w: number) {
  ctx.save();
  ctx.strokeStyle = '#c9c0b4';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(28, y);
  ctx.lineTo(w - 28, y);
  ctx.stroke();
  ctx.restore();
}

export interface ReceiptOptions {
  /** "void": the sheet crumpled on delete. "deploy": the ticket printed when a deployment starts. */
  variant?: 'void' | 'deploy';
  /** Deployment this one was redeployed from (shown on deploy tickets). */
  redeployOf?: string;
}

/**
 * Draws the deployment as a paper receipt and returns it as a PNG data URL: crumpled when a
 * deployment is deleted, printed when one starts. Uses the app's own fonts (from the next/font variables).
 */
export async function makeReceipt(d: Deployment, { variant = 'void', redeployOf }: ReceiptOptions = {}): Promise<string> {
  const css = getComputedStyle(document.documentElement);
  const mono = `${css.getPropertyValue('--font-mono-family').trim() || ''}, ${FALLBACK_MONO}`.replace(/^, /, '');
  const sans = `${css.getPropertyValue('--font-sans-family').trim() || ''}, ${FALLBACK_SANS}`.replace(/^, /, '');
  try {
    await Promise.all([document.fonts.load(`500 12px ${mono}`), document.fonts.load(`700 12px ${sans}`)]);
  } catch {
    /* fall back to system fonts */
  }

  const scale = 2;
  const W = RECEIPT.width * scale;
  const H = RECEIPT.height * scale;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const w = RECEIPT.width;
  const h = RECEIPT.height;

  // Paper with a faint warm vignette.
  ctx.fillStyle = RECEIPT_PAPER;
  ctx.fillRect(0, 0, w, h);
  const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(120,90,60,0.08)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  // Logo tile.
  const lx = 28;
  const ly = 26;
  const ls = 30;
  const grad = ctx.createLinearGradient(lx, ly, lx + ls, ly + ls);
  grad.addColorStop(0, brand[400]);
  grad.addColorStop(1, brand[600]);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(lx, ly, ls, ls, 7);
  ctx.fill();
  ctx.save();
  ctx.translate(lx + ls / 2, ly + ls / 2);
  ctx.scale(0.9, 0.9);
  ctx.translate(-12, -12);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of LOGO_PATHS) ctx.stroke(new Path2D(p));
  ctx.restore();

  ctx.fillStyle = INK;
  ctx.font = `700 17px ${sans}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('Kiln', lx + ls + 10, ly + ls / 2 - 6);
  ctx.fillStyle = FADED;
  ctx.font = `500 8.5px ${mono}`;
  ctx.fillText(variant === 'deploy' ? (redeployOf ? 'REDEPLOY TICKET' : 'DEPLOY TICKET') : 'DEPLOYMENT RECEIPT', lx + ls + 10, ly + ls / 2 + 9);

  ctx.textAlign = 'right';
  ctx.fillText(`#${d.id.toUpperCase()}`, w - 28, ly + ls / 2 - 6);
  ctx.fillText(new Date(d.createdAt).toLocaleDateString(), w - 28, ly + ls / 2 + 9);
  ctx.textAlign = 'left';

  dashedRule(ctx, 76, w);

  // Project name.
  ctx.fillStyle = INK;
  ctx.font = `700 15px ${sans}`;
  ctx.fillText(fit(ctx, repoName(d.repoUrl), w - 56), 28, 98);
  ctx.fillStyle = FADED;
  ctx.font = `500 9.5px ${mono}`;
  ctx.fillText(fit(ctx, displayUrl(d.url), w - 56), 28, 116);

  // Line items.
  const source = (() => {
    try {
      return new URL(d.repoUrl).hostname;
    } catch {
      return 'git';
    }
  })();
  const rows: [string, string][] =
    variant === 'deploy'
      ? [
          ['BRANCH', d.branch || 'default'],
          ['SOURCE', source],
          ['FROM', redeployOf ? `#${redeployOf}` : 'new deploy'],
          ['WORKER', 'next available'],
          ['QUEUED', new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })],
          ['STATUS', d.status.toUpperCase()],
        ]
      : [
    ['BRANCH', d.branch || 'default'],
    ['COMMIT', d.commitSha ? d.commitSha.slice(0, 7) : '-'],
    ['FRAMEWORK', d.framework ?? '-'],
    ['FILES', d.fileCount != null ? `${d.fileCount} · ${formatBytes(d.totalBytes)}` : '-'],
    ['BUILD', d.buildDurationMs != null ? `${(d.buildDurationMs / 1000).toFixed(1)}s` : '-'],
    ['STATUS', d.status.toUpperCase()],
  ];
  let y = 146;
  ctx.font = `500 10px ${mono}`;
  for (const [label, value] of rows) {
    ctx.fillStyle = FADED;
    ctx.textAlign = 'left';
    ctx.fillText(label, 28, y);
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText(fit(ctx, value, w - 56 - 90), w - 28, y);
    y += 21;
  }
  ctx.textAlign = 'left';

  dashedRule(ctx, y - 4, w);

  // Barcode from the id.
  let seed = hashString(d.id);
  const rand = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0) % 1000) / 1000;
  let bx = 28;
  const by = y + 12;
  ctx.fillStyle = INK;
  while (bx < w - 28) {
    const bw = 1 + Math.floor(rand() * 3);
    if (rand() > 0.35) ctx.fillRect(bx, by, bw, 34);
    bx += bw + 1 + Math.floor(rand() * 2);
  }
  ctx.fillStyle = FADED;
  ctx.font = `500 8px ${mono}`;
  ctx.textAlign = 'center';
  ctx.fillText(d.id, w / 2, by + 46);

  // Stamp: red "VOID" on the sheet being deleted, orange "FIRING" on a fresh ticket.
  const stamp = variant === 'deploy' ? { text: 'FIRING', color: 'rgba(234, 88, 12, 0.8)' } : { text: 'VOID', color: 'rgba(225, 29, 72, 0.75)' };
  ctx.save();
  ctx.translate(w - 78, h - 52);
  ctx.rotate(-0.22);
  ctx.strokeStyle = stamp.color;
  ctx.fillStyle = stamp.color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.roundRect(-46, -16, 92, 32, 5);
  ctx.stroke();
  ctx.font = `700 15px ${mono}`;
  ctx.textAlign = 'center';
  ctx.fillText(stamp.text, 0, 1);
  ctx.restore();

  ctx.fillStyle = FADED;
  ctx.font = `500 8px ${mono}`;
  ctx.textAlign = 'left';
  ctx.fillText('thanks for shipping with kiln', 28, h - 22);

  return canvas.toDataURL('image/png');
}

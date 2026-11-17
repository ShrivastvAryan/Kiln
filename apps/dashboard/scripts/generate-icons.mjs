/**
 * Generates every Kiln app icon from one SVG design.
 *
 *   npm run icons -w @deployx/dashboard
 *
 * Outputs
 *   src/app/icon.svg            favicon (scalable, modern browsers)
 *   src/app/favicon.ico         16/32/48 px favicon for older browsers
 *   src/app/apple-icon.png      180 px iOS home-screen icon (full-bleed; iOS rounds it)
 *   public/icons/icon-192.png   Android / PWA (purpose: any)
 *   public/icons/icon-512.png   Android / PWA splash (purpose: any)
 *   public/icons/maskable-192.png, maskable-512.png
 *                               Android adaptive icons (purpose: maskable): glyph kept inside the
 *                               80% safe zone so circle/squircle crops never cut it off.
 *
 * The mark: code brackets < > with an upward "ship it" arrow, white on the Sunset orange gradient.
 * Keep GLYPH in sync with src/components/LogoMark.tsx.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Glyph on a 24×24 grid (same paths as LogoMark.tsx). */
const GLYPH = [
  'M7 7.25 2.25 12 7 16.75', // <
  'M17 7.25 21.75 12 17 16.75', // >
  'M12 18V6.25', // arrow shaft
  'm9.25 9 2.75-2.75L14.75 9', // arrow head
];

const ORANGE_LIGHT = '#fb923c';
const ORANGE_DARK = '#ea580c';

/**
 * @param {object} o
 * @param {number} o.radius   corner radius on the 512 canvas (0 = full-bleed square)
 * @param {number} o.scale    glyph scale on the 512 canvas (24-grid units → px)
 * @param {number} o.stroke   stroke width in 24-grid units
 */
function svg({ radius, scale, stroke }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ORANGE_LIGHT}"/>
      <stop offset="1" stop-color="${ORANGE_DARK}"/>
    </linearGradient>
    <radialGradient id="shine" cx="0.3" cy="0.2" r="0.9">
      <stop offset="0" stop-color="#fff" stop-opacity="0.22"/>
      <stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#g)"/>
  <rect width="512" height="512" rx="${radius}" fill="url(#shine)"/>
  <g transform="translate(256 256) scale(${scale}) translate(-12 -12)" fill="none" stroke="#fff"
     stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
    ${GLYPH.map((d) => `<path d="${d}"/>`).join('\n    ')}
  </g>
</svg>`;
}

const ROUNDED = svg({ radius: 112, scale: 15.5, stroke: 2.3 }); // favicon / "any" icons
const FULL_BLEED = svg({ radius: 0, scale: 15, stroke: 2.3 }); // iOS applies its own mask
const MASKABLE = svg({ radius: 0, scale: 11.5, stroke: 2.4 }); // glyph within the safe zone
const TINY = svg({ radius: 112, scale: 18, stroke: 2.8 }); // bolder for 16–48 px favicons

const png = (source, size) => sharp(Buffer.from(source)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** Minimal ICO writer: PNG-compressed entries (supported by every current browser). */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, data } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const out = (p) => path.join(ROOT, p);

await fs.mkdir(out('public/icons'), { recursive: true });
await fs.writeFile(out('src/app/icon.svg'), ROUNDED + '\n');
await fs.writeFile(
  out('src/app/favicon.ico'),
  ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(TINY, size) })))),
);
await fs.writeFile(out('src/app/apple-icon.png'), await png(FULL_BLEED, 180));
for (const size of [192, 512]) {
  await fs.writeFile(out(`public/icons/icon-${size}.png`), await png(ROUNDED, size));
  await fs.writeFile(out(`public/icons/maskable-${size}.png`), await png(MASKABLE, size));
}

console.log('✓ Icons generated: icon.svg, favicon.ico, apple-icon.png, public/icons/{icon,maskable}-{192,512}.png');

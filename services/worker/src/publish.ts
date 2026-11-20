import path from 'node:path';

/** Never published, whatever the output directory. */
const ALWAYS_SKIPPED_DIRS = new Set(['node_modules', '.git']);

/**
 * File types a browser can use. When the output directory is the repository root, nothing else is
 * published, so server code, lockfiles, Dockerfiles and notes never become public URLs.
 */
const WEB_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.map', '.json', '.webmanifest', '.xml', '.txt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.m4a',
  '.pdf', '.wasm', '.csv',
]);

/** Project config that happens to use a web extension. */
const ROOT_CONFIG_FILES = new Set([
  'package.json', 'package-lock.json', 'tsconfig.json', 'jsconfig.json', 'composer.json',
  'composer.lock', 'vercel.json', 'netlify.toml', 'firebase.json', 'renovate.json', 'deno.json',
]);

const isDotfile = (segment: string) => segment.startsWith('.') && segment !== '.well-known';

/**
 * Decide which files under the output directory are uploaded. Dotfiles (.env, .github/, …) are never
 * published. A built output folder (dist/, build/, …) is otherwise published as-is; the repository
 * root is limited to web assets.
 */
export function publishFilter(outputDir: string) {
  const isRoot = outputDir === '.';
  return (rel: string, isDir: boolean) => {
    const segments = rel.split('/');
    if (segments.some((s) => ALWAYS_SKIPPED_DIRS.has(s) || isDotfile(s))) return true;
    if (!isRoot || isDir) return false;
    if (segments.length === 1 && ROOT_CONFIG_FILES.has(segments[0])) return true;
    return !WEB_EXTENSIONS.has(path.posix.extname(rel).toLowerCase());
  };
}

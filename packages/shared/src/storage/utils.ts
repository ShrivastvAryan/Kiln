import fs from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime-types';

export function contentTypeFor(file: string) {
  return mime.contentType(path.extname(file)) || 'application/octet-stream';
}

/** Recursively list files under a directory (relative POSIX paths). */
export async function walk(dir: string, ignore: (rel: string) => boolean = () => false) {
  const out: string[] = [];
  async function recurse(current: string) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      if (ignore(rel)) continue;
      if (entry.isDirectory()) await recurse(abs);
      else if (entry.isFile()) out.push(rel);
    }
  }
  await recurse(dir);
  return out;
}

/** Run async tasks with bounded concurrency. */
export async function pool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(runners);
}

import fs from 'node:fs/promises';
import path from 'node:path';

export interface BuildPlan {
  framework: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'none';
  installCommand: string | null;
  buildCommand: string | null;
  /** Explicit output dir; when null, it's discovered after the build. */
  outputDir: string | null;
}

const FRAMEWORKS: { dep: string; name: string; output: string }[] = [
  { dep: 'next', name: 'Next.js (static export)', output: 'out' },
  { dep: 'astro', name: 'Astro', output: 'dist' },
  { dep: '@sveltejs/kit', name: 'SvelteKit (static)', output: 'build' },
  { dep: 'gatsby', name: 'Gatsby', output: 'public' },
  { dep: '@docusaurus/core', name: 'Docusaurus', output: 'build' },
  { dep: '@angular/core', name: 'Angular', output: 'dist' },
  { dep: 'react-scripts', name: 'Create React App', output: 'build' },
  { dep: 'vite', name: 'Vite', output: 'dist' },
  { dep: 'parcel', name: 'Parcel', output: 'dist' },
];

export const OUTPUT_CANDIDATES = ['dist', 'build', 'out', 'public', '_site', '.'];

async function exists(p: string) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function detectBuildPlan(dir: string): Promise<BuildPlan> {
  const pkgPath = path.join(dir, 'package.json');
  if (!(await exists(pkgPath))) {
    return { framework: 'Static HTML', packageManager: 'none', installCommand: null, buildCommand: null, outputDir: '.' };
  }

  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const fw = FRAMEWORKS.find((f) => f.dep in deps);

  let packageManager: BuildPlan['packageManager'] = 'npm';
  let installCommand = 'npm install --no-audit --no-fund';
  if (await exists(path.join(dir, 'pnpm-lock.yaml'))) {
    packageManager = 'pnpm';
    installCommand = 'npx --yes pnpm@9 install --frozen-lockfile=false';
  } else if (await exists(path.join(dir, 'yarn.lock'))) {
    packageManager = 'yarn';
    installCommand = 'npx --yes yarn@1 install --non-interactive';
  } else if (await exists(path.join(dir, 'bun.lockb'))) {
    packageManager = 'bun';
    installCommand = 'npx --yes bun install';
  } else if (await exists(path.join(dir, 'package-lock.json'))) {
    installCommand = 'npm ci --no-audit --no-fund';
  }

  const run = {
    npm: 'npm run',
    pnpm: 'npx --yes pnpm@9 run',
    yarn: 'npx --yes yarn@1 run',
    bun: 'npx --yes bun run',
    none: 'npm run',
  }[packageManager];

  return {
    framework: fw?.name ?? 'Node.js',
    packageManager,
    installCommand,
    buildCommand: pkg.scripts?.build ? `${run} build` : null,
    outputDir: null,
  };
}

/** After building, find the directory that contains the site (prefer ones with index.html). */
export async function resolveOutputDir(dir: string, hint: string | null): Promise<string | null> {
  if (hint) return (await exists(path.join(dir, hint))) ? hint : null;
  for (const c of OUTPUT_CANDIDATES) {
    if (await exists(path.join(dir, c, 'index.html'))) return c;
  }
  return null;
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { APP_PORT } from './runtime';

export interface BuildPlan {
  framework: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'none';
  installCommand: string | null;
  buildCommand: string | null;
  /** Explicit output dir; when null, it's discovered after the build. */
  outputDir: string | null;
  /** Set when the repo looks like a server app (Django, Go, …) that a static host can't run. */
  serverApp?: string;
  /**
   * How to run the app as a Node server when the build leaves no static site behind
   * (Next.js without `output: 'export'`, or any app with a "start" script).
   */
  startCommand?: { command: string; framework: string };
}

const FRAMEWORKS: { dep: string; name: string; output: string }[] = [
  { dep: 'next', name: 'Next.js', output: 'out' },
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

/** Marker files of server-side apps, checked in order. */
const SERVER_APPS: { file: string; name: string }[] = [
  { file: 'manage.py', name: 'Django (Python)' },
  { file: 'pyproject.toml', name: 'Python' },
  { file: 'requirements.txt', name: 'Python' },
  { file: 'Pipfile', name: 'Python' },
  { file: 'go.mod', name: 'Go' },
  { file: 'Cargo.toml', name: 'Rust' },
  { file: 'Gemfile', name: 'Ruby' },
  { file: 'composer.json', name: 'PHP' },
  { file: 'pom.xml', name: 'Java (Maven)' },
  { file: 'build.gradle', name: 'Java (Gradle)' },
];

async function detectServerApp(dir: string) {
  for (const s of SERVER_APPS) if (await exists(path.join(dir, s.file))) return s.name;
  return undefined;
}

export async function detectBuildPlan(dir: string): Promise<BuildPlan> {
  const pkgPath = path.join(dir, 'package.json');
  if (!(await exists(pkgPath))) {
    const serverApp = await detectServerApp(dir);
    return {
      framework: serverApp ?? 'Static HTML',
      packageManager: 'none',
      installCommand: null,
      buildCommand: null,
      // Discovered after the "build": the folder must actually contain an index.html.
      outputDir: null,
      serverApp,
    };
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

  const isNext = fw?.dep === 'next';
  const startCommand = isNext
    ? { command: `node_modules/.bin/next start -p ${APP_PORT} -H 0.0.0.0`, framework: 'Next.js (server)' }
    : pkg.scripts?.start
      ? { command: `${run} start`, framework: `${fw?.name ?? 'Node.js'} (server)` }
      : undefined;

  return {
    framework: fw?.name ?? 'Node.js',
    packageManager,
    installCommand,
    buildCommand: pkg.scripts?.build ? `${run} build` : null,
    outputDir: null,
    startCommand,
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

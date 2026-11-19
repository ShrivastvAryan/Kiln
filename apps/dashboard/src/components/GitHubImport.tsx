'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'motion/react';
import { ArrowRight, Check, ExternalLink, Lock, RefreshCw, Search, Settings2, Unplug, X } from 'lucide-react';
import { startGitHubConnect, type GitHubStatusState } from '@/hooks/github';
import { api, type GitHubRepo } from '@/lib/api';
import { cn } from '@/lib/format';
import { Button, Card, GitHubIcon, useToast } from './ui';

const EASE = [0.2, 0.9, 0.3, 1] as const;

/** GitHub's own language colours for the common web stacks. */
const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  HTML: '#e34c26',
  CSS: '#663399',
  SCSS: '#c6538c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Astro: '#ff5a03',
  MDX: '#fcb32c',
  Python: '#3572a5',
  Go: '#00add8',
  Rust: '#dea584',
  Shell: '#89e051',
};
export const langColor = (lang: string | null) => (lang && LANG_COLORS[lang]) || 'var(--dx-subtle)';

/** Compact relative time that stays relative ("3w ago", "4mo ago") instead of falling back to a date. */
function ago(iso: string | null) {
  if (!iso) return null;
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  const steps: [number, string][] = [
    [60, 's'],
    [60, 'm'],
    [24, 'h'],
    [7, 'd'],
    [4.35, 'w'],
    [12, 'mo'],
  ];
  let v = s;
  for (const [size, unit] of steps) {
    if (v < size) return unit === 's' ? 'just now' : `${Math.floor(v)}${unit} ago`;
    v /= size;
  }
  return `${Math.floor(v)}y ago`;
}

/** "Import from GitHub" panel on the New deployment page. */
export function GitHubImport({
  selectedUrl,
  onPick,
  autoConnect,
  github,
}: {
  /** Shared with the page so it can lay itself out around whether GitHub is available. */
  github: GitHubStatusState;
  selectedUrl: string;
  onPick: (repo: GitHubRepo) => void;
  /** Just came back from installing the app on GitHub: finish connecting automatically. */
  autoConnect?: boolean;
}) {
  const { status, reload } = github;
  const toast = useToast();
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const [spins, setSpins] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const connect = async () => {
    setConnecting(true);
    try {
      await startGitHubConnect('/new');
    } catch (e) {
      toast({ tone: 'error', title: 'Could not start GitHub connection', description: (e as Error).message });
      setConnecting(false);
    }
  };

  const loadRepos = async () => {
    setLoadingRepos(true);
    setError(null);
    try {
      setRepos((await api.githubRepos()).repos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingRepos(false);
    }
  };

  useEffect(() => {
    if (status?.connected) void loadRepos();
    else if (status?.configured && autoConnect) void connect();
  }, [status?.connected, status?.configured]); // eslint-disable-line react-hooks/exhaustive-deps

  // "/" jumps to the search box (unless you're already typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== '/' || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (repos ?? [])
      .filter((r) => !q || r.fullName.toLowerCase().includes(q))
      .sort((a, b) => Number(a.private) - Number(b.private)); // importable first, order otherwise kept
  }, [repos, query]);

  if (!status?.configured) return null;

  if (!status.connected) {
    return (
      <MotionConfig reducedMotion="user">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
          <Card className="relative overflow-hidden p-5">
            <Glow />
            <div className="relative flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-fg text-bg shadow-sm">
                <GitHubIcon className="size-5" />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Import from GitHub</h2>
                <p className="text-xs text-subtle">Pick a repo instead of pasting its URL.</p>
              </div>
            </div>
            <ul className="relative mt-4 space-y-1.5 text-xs text-muted">
              {['You choose exactly which repos', 'Read-only access', 'Disconnect anytime'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="size-3.5 text-success" /> {t}
                </li>
              ))}
            </ul>
            <Button variant="primary" className="relative mt-5 w-full" loading={connecting} onClick={connect}>
              <GitHubIcon className="size-4" /> Connect GitHub
            </Button>
          </Card>
        </motion.div>
      </MotionConfig>
    );
  }

  const count = repos?.length ?? 0;

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.25, ease: EASE }}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE }}>
        <Card className="relative overflow-hidden">
          <Glow />

          {/* Header */}
          <div className="relative flex items-center justify-between gap-3 px-4 pt-4 pb-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative shrink-0">
                {status.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={status.avatarUrl}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="size-9 rounded-full ring-1 ring-line-strong"
                  />
                ) : (
                  <span className="grid size-9 place-items-center rounded-full bg-elevated">
                    <GitHubIcon className="size-4" />
                  </span>
                )}
                <span className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-fg text-bg ring-2 ring-surface">
                  <GitHubIcon className="size-2.5" />
                </span>
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold tracking-tight">Import from GitHub</h2>
                  <AnimatePresence>
                    {repos && (
                      <motion.span
                        key="count"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="rounded-full bg-elevated px-1.5 py-px font-mono text-[10px] text-muted tabular-nums"
                      >
                        {count}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
                <p className="truncate text-xs text-subtle">@{status.login}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setSpins((n) => n + 1);
                void loadRepos();
              }}
              aria-label="Refresh repositories"
              title="Refresh"
              className="grid size-8 place-items-center rounded-lg text-subtle transition-colors hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none cursor-pointer"
            >
              <motion.span
                animate={{ rotate: spins * 360 }}
                transition={{ duration: 0.6, ease: EASE }}
                className={cn('grid', loadingRepos && 'animate-spin')}
              >
                <RefreshCw className="size-3.5" />
              </motion.span>
            </button>
          </div>

          {/* Search */}
          <div className="relative px-3 pb-2">
            <div className="group relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle transition-colors group-focus-within:text-accent" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), e.currentTarget.blur())}
                placeholder="Search repositories"
                aria-label="Search repositories"
                className="h-9 w-full rounded-lg border border-line bg-bg/60 pr-9 pl-9 text-[13px] transition-[border-color,box-shadow] placeholder:text-subtle focus:border-accent focus:shadow-[0_0_0_3px_var(--dx-accent-soft)] focus:outline-none"
              />
              <span className="absolute top-1/2 right-2 -translate-y-1/2">
                <AnimatePresence mode="wait" initial={false}>
                  {query ? (
                    <motion.button
                      key="clear"
                      type="button"
                      initial={{ opacity: 0, scale: 0.7 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.7 }}
                      transition={{ duration: 0.15 }}
                      onClick={() => (setQuery(''), searchRef.current?.focus())}
                      aria-label="Clear search"
                      className="grid size-5 place-items-center rounded text-subtle hover:bg-hover hover:text-fg cursor-pointer"
                    >
                      <X className="size-3" />
                    </motion.button>
                  ) : (
                    <motion.kbd
                      key="kbd"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="hidden rounded border border-line px-1.5 font-mono text-[10px] leading-4 text-subtle sm:block"
                    >
                      /
                    </motion.kbd>
                  )}
                </AnimatePresence>
              </span>
            </div>
          </div>

          {/* List */}
          <div className="relative">
            <ul
              className="max-h-[26rem] overflow-y-auto px-2 py-1 [scrollbar-color:var(--dx-line-strong)_transparent] [scrollbar-width:thin] [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%-18px),transparent)]"
              aria-busy={loadingRepos}
              onMouseLeave={() => setHovered(null)}
            >
              {error && (
                <li className="flex flex-col items-center gap-3 px-3 py-8 text-center">
                  <p className="text-xs text-danger">{error}</p>
                  <Button size="sm" onClick={loadRepos} icon={<RefreshCw className="size-3.5" />}>
                    Try again
                  </Button>
                </li>
              )}

              {!error && repos === null && <Skeleton />}

              {!error && repos?.length === 0 && (
                <li className="px-3 py-8 text-center">
                  <p className="text-xs text-muted">No repositories shared with Kiln yet.</p>
                  <a
                    href={status.installUrl ?? status.manageUrl}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                  >
                    Choose repos on GitHub <ArrowRight className="size-3" />
                  </a>
                </li>
              )}

              <LayoutGroup>
                <AnimatePresence initial={true} mode="popLayout">
                  {filtered.map((repo, i) => (
                    <RepoRow
                      key={repo.id}
                      repo={repo}
                      index={i}
                      login={status.login}
                      selected={selectedUrl === repo.htmlUrl}
                      hovered={hovered === repo.id}
                      onHover={() => setHovered(repo.id)}
                      onPick={() => onPick(repo)}
                    />
                  ))}
                </AnimatePresence>
              </LayoutGroup>

              {repos && repos.length > 0 && filtered.length === 0 && (
                <motion.li
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="px-3 py-8 text-center text-xs text-muted"
                >
                  No repositories match “{query}”.
                </motion.li>
              )}
            </ul>
          </div>

          {/* Footer */}
          <div className="relative flex items-center justify-between gap-2 border-t border-line bg-bg/40 px-4 py-2.5 text-xs">
            <a
              href={status.manageUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md text-muted transition-colors hover:text-fg"
            >
              <Settings2 className="size-3.5" /> Repository access <ExternalLink className="size-3 opacity-60" />
            </a>
            <button
              type="button"
              onClick={async () => {
                await api.githubDisconnect();
                setRepos(null);
                await reload();
                toast({ tone: 'success', title: 'GitHub disconnected', description: 'Remove the app on GitHub to revoke access fully.' });
              }}
              className="inline-flex items-center gap-1.5 rounded-md text-muted transition-colors hover:text-danger cursor-pointer"
            >
              <Unplug className="size-3.5" /> Disconnect
            </button>
          </div>
        </Card>
      </motion.div>
    </MotionConfig>
  );
}

function RepoRow({
  repo,
  index,
  login,
  selected,
  hovered,
  onHover,
  onPick,
}: {
  repo: GitHubRepo;
  index: number;
  login: string | null;
  selected: boolean;
  hovered: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const color = langColor(repo.language);
  const pushed = ago(repo.pushedAt);
  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE, delay: Math.min(index * 0.035, 0.35) } }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
      className="relative"
    >
      {/* One highlight that glides between rows. */}
      {hovered && !repo.private && (
        <motion.span
          layoutId="gh-row-hover"
          className="absolute inset-0 rounded-lg bg-hover"
          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        />
      )}
      {selected && (
        <motion.span
          layoutId="gh-row-selected"
          className="absolute inset-0 rounded-lg bg-accent-soft ring-1 ring-accent/30"
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        />
      )}
      <button
        type="button"
        disabled={repo.private}
        onClick={onPick}
        onMouseEnter={onHover}
        onFocus={onHover}
        aria-pressed={selected}
        title={repo.private ? 'Private repositories are coming soon' : `Import ${repo.fullName}`}
        className={cn(
          'group relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
          repo.private ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
        )}
      >
        <RepoGlyph repo={repo} />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[13px] leading-5">
            <span className="truncate">
              {repo.owner !== login && <span className="text-subtle">{repo.owner}/</span>}
              <span className="font-medium text-fg">{repo.name}</span>
            </span>
            {repo.private && <Lock className="size-3 shrink-0 text-subtle" />}
          </span>
          <span className="flex items-center gap-1.5 truncate text-[11px] text-subtle">
            {repo.private ? (
              'Private · coming soon'
            ) : (
              <>
                {repo.language && (
                  <span className="inline-flex items-center gap-1">
                    <span className="size-1.5 rounded-full" style={{ background: color }} />
                    {repo.language}
                  </span>
                )}
                {repo.language && pushed && <span className="opacity-50">·</span>}
                {pushed ?? repo.defaultBranch}
              </>
            )}
          </span>
        </span>

        {!repo.private && (
          <span className="relative flex h-7 shrink-0 items-center">
            {selected ? (
              <motion.span
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-[11px] font-semibold text-accent-fg"
              >
                <Check className="size-3" strokeWidth={3} /> Selected
              </motion.span>
            ) : (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-200',
                  hovered
                    ? 'border-line-strong bg-surface text-fg shadow-sm'
                    : 'border-transparent text-subtle',
                )}
              >
                Import
                <ArrowRight
                  className={cn('size-3 transition-transform duration-200', hovered ? 'translate-x-0.5' : '-translate-x-0.5 opacity-0')}
                />
              </span>
            )}
          </span>
        )}
      </button>
    </motion.li>
  );
}

function Skeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-2.5 py-2" style={{ opacity: 1 - i * 0.16 }}>
          <span className="size-8 animate-pulse rounded-lg bg-elevated" />
          <span className="flex-1 space-y-1.5">
            <span className="block h-3 w-2/5 animate-pulse rounded bg-elevated" />
            <span className="block h-2.5 w-1/4 animate-pulse rounded bg-elevated" />
          </span>
        </li>
      ))}
    </>
  );
}

/** Soft orange wash in the top corner, ties the panel to the brand without shouting. */
function Glow() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute -top-24 -right-16 size-56 rounded-full opacity-70 blur-3xl"
      style={{ background: 'var(--dx-accent-soft)' }}
    />
  );
}

/** Letter tile tinted with the repo's language colour. */
export function RepoGlyph({ repo, className }: { repo: Pick<GitHubRepo, 'name' | 'language'>; className?: string }) {
  const color = langColor(repo.language);
  return (
    <span
      aria-hidden="true"
      className={cn('grid size-8 shrink-0 place-items-center rounded-lg font-mono text-[13px] font-semibold uppercase', className)}
      style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
    >
      {repo.name[0]}
    </span>
  );
}

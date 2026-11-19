'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, FolderOutput, GitBranch, Hammer, Link2, Package, Rocket, X } from 'lucide-react';
import { GitHubImport, RepoGlyph } from '@/components/GitHubImport';
import { PageHeader } from '@/components/Layout';
import { Button, Card, Field, Input, useToast } from '@/components/ui';
import { useDeployments } from '@/hooks/deployments';
import { useGitHubStatus } from '@/hooks/github';
import { ApiError, api, type GitHubRepo } from '@/lib/api';
import { DeployDialog } from '@/components/DeployDialog';
import { cn, repoName } from '@/lib/format';

const EXAMPLES = [
  { name: 'Static HTML', repo: 'https://github.com/mdn/beginner-html-site-styled' },
  { name: 'React to-do', repo: 'https://github.com/mdn/todo-react' },
  { name: 'Vite + React', repo: 'https://github.com/SafdarJamal/vite-template-react' },
  { name: 'Svelte', repo: 'https://github.com/sveltejs/template' },
];

const HOW_IT_WORKS = [
  { icon: GitBranch, title: 'Clone', text: 'Shallow clone of the branch, snapshotted to object storage.' },
  { icon: Package, title: 'Queue', text: 'Job pushed onto a Redis queue; the next free worker picks it up.' },
  { icon: Hammer, title: 'Build', text: 'Install + build inside a sandboxed container, logs streamed live.' },
  { icon: Rocket, title: 'Serve', text: 'Output uploaded and routed to its own subdomain instantly.' },
];

export function NewDeploymentPage() {
  const router = useRouter();
  const toast = useToast();
  const { upsert } = useDeployments();
  const repoRef = useRef<HTMLInputElement>(null);
  const configRef = useRef<HTMLDivElement>(null);
  const github = useGitHubStatus();
  const hasGitHub = !github.loaded || !!github.status?.configured;
  const [picked, setPicked] = useState<GitHubRepo | null>(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [installCommand, setInstallCommand] = useState('');
  const [buildCommand, setBuildCommand] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Without a repo picker, the URL field is the way in: focus it.
  useEffect(() => {
    if (github.loaded && !github.status?.connected) repoRef.current?.focus();
  }, [github.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (repo: GitHubRepo) => {
    setPicked(repo);
    setRepoUrl(repo.htmlUrl);
    setBranch(repo.defaultBranch);
    setErrors({});
    // On narrow screens the form is below the list: bring it into view.
    if (window.matchMedia('(max-width: 1023px)').matches)
      configRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const clearPick = () => {
    setPicked(null);
    setRepoUrl('');
    setBranch('');
    repoRef.current?.focus();
  };

  // Coming back from GitHub (connect / install): report the outcome, then clean the URL.
  const params = useSearchParams();
  const githubResult = params.get('github');
  useEffect(() => {
    if (!githubResult) return;
    const messages: Record<string, [ 'success' | 'error', string, string? ]> = {
      connected: ['success', 'GitHub connected', 'Pick a repository to import.'],
      denied: ['error', 'GitHub connection cancelled'],
      expired: ['error', 'That GitHub connection attempt expired', 'Please try again.'],
      failed: ['error', 'Could not connect GitHub', 'Please try again.'],
    };
    const m = messages[githubResult];
    if (m) toast({ tone: m[0], title: m[1], description: m[2] });
    if (githubResult !== 'installed') router.replace('/new');
  }, [githubResult]); // eslint-disable-line react-hooks/exhaustive-deps

  const [deployOpen, setDeployOpen] = useState(false);

  /** Creates the deployment (run by the deploy dialog). Field errors are marked on the form too. */
  const deploy = async () => {
    try {
      const d = await api.createDeployment({ repoUrl, branch, installCommand, buildCommand, outputDir });
      upsert(d);
      return d;
    } catch (err) {
      const e = err as ApiError;
      if (e.field) {
        setErrors({ [e.field]: e.message });
        if (e.field !== 'repoUrl') setAdvanced(true);
      }
      throw err;
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (!repoUrl.trim()) {
      setErrors({ repoUrl: 'Repository URL is required' });
      repoRef.current?.focus();
      return;
    }
    setDeployOpen(true);
  };

  const form = (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <Field
        label={picked ? 'Repository URL' : 'Git repository URL'}
        htmlFor="repoUrl"
        error={errors.repoUrl}
        hint={picked ? undefined : 'GitHub, GitLab, Bitbucket or any public https:// Git remote.'}
      >
        <Input
          id="repoUrl"
          ref={repoRef}
          icon={<Link2 className="size-4" />}
          placeholder="https://github.com/username/repository"
          value={repoUrl}
          invalid={!!errors.repoUrl}
          onChange={(e) => {
            setRepoUrl(e.target.value);
            if (picked && e.target.value !== picked.htmlUrl) setPicked(null);
          }}
          autoComplete="off"
          spellCheck={false}
          inputMode="url"
        />
      </Field>

      {!picked && !repoUrl && (
        <div className="-mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs text-subtle">Try an example:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.repo}
              type="button"
              onClick={() => (setRepoUrl(ex.repo), setErrors({}))}
              className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted transition-colors hover:border-line-strong hover:bg-hover hover:text-fg cursor-pointer"
            >
              {ex.name}
            </button>
          ))}
        </div>
      )}

      <Field label="Branch" htmlFor="branch" error={errors.branch} hint="Leave empty to use the default branch.">
        <Input
          id="branch"
          icon={<GitBranch className="size-4" />}
          placeholder="main"
          value={branch}
          invalid={!!errors.branch}
          onChange={(e) => setBranch(e.target.value)}
          spellCheck={false}
        />
      </Field>

      <div className="rounded-lg border border-line">
        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium cursor-pointer"
        >
          <span>
            Build & output settings
            <span className="ml-2 text-xs font-normal text-subtle">optional</span>
          </span>
          <ChevronDown className={cn('size-4 text-subtle transition-transform duration-200', advanced && 'rotate-180')} />
        </button>
        <AnimatePresence initial={false}>
          {advanced && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.2, 0.9, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="grid gap-4 border-t border-line p-4">
                <Field label="Install command" htmlFor="install" error={errors.installCommand}>
                  <Input
                    id="install"
                    icon={<Package className="size-4" />}
                    placeholder="Auto: npm ci / pnpm / yarn"
                    value={installCommand}
                    onChange={(e) => setInstallCommand(e.target.value)}
                    className="font-mono text-[13px]"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Build command" htmlFor="build" error={errors.buildCommand}>
                  <Input
                    id="build"
                    icon={<Hammer className="size-4" />}
                    placeholder="Auto: npm run build"
                    value={buildCommand}
                    onChange={(e) => setBuildCommand(e.target.value)}
                    className="font-mono text-[13px]"
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="Output directory"
                  htmlFor="output"
                  error={errors.outputDir}
                  hint="Auto-detected from dist/, build/, out/ or public/."
                >
                  <Input
                    id="output"
                    icon={<FolderOutput className="size-4" />}
                    placeholder="Auto-detect"
                    value={outputDir}
                    onChange={(e) => setOutputDir(e.target.value)}
                    className="font-mono text-[13px]"
                    spellCheck={false}
                  />
                </Field>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          className="flex-1"
          loading={deployOpen}
          icon={<Rocket className="size-4" />}
        >
          {picked ? `Deploy ${picked.name}` : 'Deploy'}
        </Button>
      </div>
    </form>
  );

  const configure = (
    <div ref={configRef} className="scroll-mt-6 lg:sticky lg:top-6">
      <Card className="overflow-hidden">
        <div className="border-b border-line px-6 py-4">
          <AnimatePresence mode="wait" initial={false}>
            {picked ? (
              <motion.div
                key={picked.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-3"
              >
                <RepoGlyph repo={picked} className="size-10 text-base" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-medium tracking-wide text-subtle uppercase">Deploying</p>
                  <p className="truncate font-semibold">{picked.fullName}</p>
                </div>
                <button
                  type="button"
                  onClick={clearPick}
                  aria-label="Clear selected repository"
                  title="Clear"
                  className="grid size-8 place-items-center rounded-lg text-subtle hover:bg-hover hover:text-fg cursor-pointer"
                >
                  <X className="size-4" />
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="url"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <h2 className="font-semibold">{hasGitHub ? 'Configure' : 'Import a repository'}</h2>
                <p className="mt-0.5 text-xs text-subtle">
                  {hasGitHub ? 'Pick a repo, or paste any public Git URL.' : 'Paste any public Git URL to deploy it.'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="p-6">{form}</div>
      </Card>
    </div>
  );

  return (
    <>
      <PageHeader
        title="New deployment"
        description="Import a repository. Framework, package manager and output folder are detected automatically."
      />

      {hasGitHub ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <GitHubImport
            github={github}
            selectedUrl={repoUrl}
            autoConnect={githubResult === 'installed'}
            onPick={pick}
          />
          {configure}
        </div>
      ) : (
        <div className="mx-auto max-w-2xl">{configure}</div>
      )}

      <section aria-labelledby="how-it-works" className="mt-10">
        <h2 id="how-it-works" className="mb-3 text-xs font-medium tracking-wide text-subtle uppercase">
          What happens when you deploy
        </h2>
        <ol className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="flex gap-3 bg-surface p-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-elevated text-muted">
                <Icon className="size-4" />
              </span>
              <div>
                <p className="text-[13px] font-medium">
                  <span className="mr-1.5 font-mono text-xs text-subtle tabular-nums">0{i + 1}</span>
                  {title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-subtle">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <DeployDialog
        open={deployOpen}
        title={`Deploying ${repoName(repoUrl) || 'repository'}`}
        run={deploy}
        onClose={(d) => {
          setDeployOpen(false);
          if (d) router.push(`/deployments/${d.id}`);
        }}
      />
    </>
  );
}

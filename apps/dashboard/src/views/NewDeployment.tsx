'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChevronDown, FolderOutput, GitBranch, Hammer, Link2, Package, Rocket } from 'lucide-react';
import { PageHeader } from '@/components/Layout';
import { Button, Card, Field, GitHubIcon, Input, useToast } from '@/components/ui';
import { useDeployments } from '@/hooks/deployments';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/format';

const EXAMPLES = [
  { name: 'Static HTML site', repo: 'https://github.com/mdn/beginner-html-site-styled', tag: 'HTML/CSS' },
  { name: 'React to-do app', repo: 'https://github.com/mdn/todo-react', tag: 'Vite + React' },
  { name: 'React starter', repo: 'https://github.com/SafdarJamal/vite-template-react', tag: 'Vite + React' },
  { name: 'Svelte app', repo: 'https://github.com/sveltejs/template', tag: 'Svelte + Rollup' },
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
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [installCommand, setInstallCommand] = useState('');
  const [buildCommand, setBuildCommand] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => repoRef.current?.focus(), []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErrors({});
    if (!repoUrl.trim()) {
      setErrors({ repoUrl: 'Repository URL is required' });
      repoRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const d = await api.createDeployment({ repoUrl, branch, installCommand, buildCommand, outputDir });
      upsert(d);
      toast({ tone: 'success', title: 'Deployment started', description: `Building ${d.id}…` });
      router.push(`/deployments/${d.id}`);
    } catch (err) {
      const e = err as ApiError;
      if (e.field) {
        setErrors({ [e.field]: e.message });
        if (e.field !== 'repoUrl') setAdvanced(true);
      } else toast({ tone: 'error', title: 'Could not create deployment', description: e.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="New deployment"
        description="Import a public Git repository. Framework, package manager and output folder are detected automatically."
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="p-6">
          <form onSubmit={submit} className="space-y-5" noValidate>
            <Field
              label="Git repository URL"
              htmlFor="repoUrl"
              error={errors.repoUrl}
              hint="GitHub, GitLab, Bitbucket or any public https:// Git remote."
            >
              <Input
                id="repoUrl"
                ref={repoRef}
                icon={<Link2 className="size-4" />}
                placeholder="https://github.com/username/repository"
                value={repoUrl}
                invalid={!!errors.repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                inputMode="url"
              />
            </Field>

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
                  <span className="ml-2 text-xs font-normal text-subtle">optional overrides</span>
                </span>
                <ChevronDown className={cn('size-4 text-subtle transition-transform', advanced && 'rotate-180')} />
              </button>
              {advanced && (
                <div className="grid animate-fade-in gap-4 border-t border-line p-4 sm:grid-cols-2">
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
                  <div className="sm:col-span-2">
                    <Field
                      label="Output directory"
                      htmlFor="output"
                      error={errors.outputDir}
                      hint="Auto-detected from dist/, build/, out/ or public/ containing an index.html."
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
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <Button type="button" variant="ghost" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" loading={submitting} icon={<Rocket className="size-4" />}>
                Deploy
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-sm font-medium">Try an example</h2>
            <p className="mt-1 text-xs text-subtle">Fill the form with a known-good public repository.</p>
            <ul className="mt-4 space-y-1.5">
              {EXAMPLES.map((ex) => (
                <li key={ex.repo}>
                  <button
                    type="button"
                    onClick={() => {
                      setRepoUrl(ex.repo);
                      setBranch('');
                      setErrors({});
                      repoRef.current?.focus();
                    }}
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors cursor-pointer',
                      repoUrl === ex.repo
                        ? 'border-accent bg-accent-soft'
                        : 'border-line hover:border-line-strong hover:bg-hover',
                    )}
                  >
                    <GitHubIcon className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{ex.name}</span>
                      <span className="block truncate text-xs text-subtle">{ex.tag}</span>
                    </span>
                    <ArrowRight className="size-3.5 text-subtle transition-transform group-hover:translate-x-0.5" />
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-medium">How it works</h2>
            <ol className="mt-4 space-y-4">
              {HOW_IT_WORKS.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="flex gap-3">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-elevated text-muted">
                    <Icon className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-[13px] font-medium">
                      <span className="mr-1.5 text-subtle tabular-nums">{i + 1}.</span>
                      {title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-subtle">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}

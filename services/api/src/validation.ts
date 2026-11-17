import type { CreateDeploymentInput } from '@deployx/shared';

export class ValidationError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

const BRANCH_RE = /^[A-Za-z0-9._\-/]{1,200}$/;
const OUTPUT_DIR_RE = /^[A-Za-z0-9._\-/]{1,200}$/;

function optionalString(value: unknown, field: string, max: number) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`, field);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new ValidationError(`${field} is too long`, field);
  return trimmed || undefined;
}

export function parseCreateInput(body: unknown): Required<Pick<CreateDeploymentInput, 'repoUrl' | 'branch'>> &
  CreateDeploymentInput {
  const input = (body ?? {}) as Record<string, unknown>;

  const repoUrlRaw = optionalString(input.repoUrl, 'repoUrl', 500);
  if (!repoUrlRaw) throw new ValidationError('Repository URL is required', 'repoUrl');

  let url: URL;
  try {
    url = new URL(repoUrlRaw);
  } catch {
    throw new ValidationError('Enter a valid URL, e.g. https://github.com/user/repo', 'repoUrl');
  }
  if (url.protocol !== 'https:') throw new ValidationError('Only https:// Git URLs are supported', 'repoUrl');
  if (url.username || url.password) throw new ValidationError('Credentials in URLs are not allowed', 'repoUrl');
  if (url.pathname.split('/').filter(Boolean).length < 2)
    throw new ValidationError('URL should point to a repository (owner/name)', 'repoUrl');

  // Empty branch = the repository's default branch (resolved after cloning).
  const branch = optionalString(input.branch, 'branch', 200) ?? '';
  if (branch && (!BRANCH_RE.test(branch) || branch.includes('..') || branch.startsWith('-')))
    throw new ValidationError('Invalid branch name', 'branch');

  const outputDir = optionalString(input.outputDir, 'outputDir', 200)?.replace(/^\.?\/+|\/+$/g, '');
  if (outputDir && (!OUTPUT_DIR_RE.test(outputDir) || outputDir.split('/').includes('..')))
    throw new ValidationError('Output directory must be a relative path inside the repo', 'outputDir');

  return {
    repoUrl: `${url.origin}${url.pathname.replace(/\/+$/, '')}`,
    branch,
    installCommand: optionalString(input.installCommand, 'installCommand', 500),
    buildCommand: optionalString(input.buildCommand, 'buildCommand', 500),
    outputDir: outputDir || undefined,
  };
}

/** Short, DNS-safe, human-friendly id: used as the deployment subdomain. */
export function generateId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let id = '';
  for (const b of bytes) id += alphabet[b % alphabet.length];
  // Subdomain labels must start with a letter for maximum compatibility.
  return /^[a-z]/.test(id) ? id : `d${id.slice(1)}`;
}

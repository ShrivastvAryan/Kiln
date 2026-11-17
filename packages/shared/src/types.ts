/** Lifecycle of a deployment: cloning → queued → building → uploading → ready | failed */
export type DeploymentStatus = 'cloning' | 'queued' | 'building' | 'uploading' | 'ready' | 'failed';

export const ACTIVE_STATUSES: DeploymentStatus[] = ['cloning', 'queued', 'building', 'uploading'];

export interface Deployment {
  id: string;
  repoUrl: string;
  branch: string;
  status: DeploymentStatus;
  url: string;
  createdAt: number;
  updatedAt: number;
  /** When a worker picked the job up. */
  startedAt?: number;
  finishedAt?: number;
  buildDurationMs?: number;
  commitSha?: string;
  commitMessage?: string;
  commitAuthor?: string;
  framework?: string;
  packageManager?: string;
  /** User overrides; empty means auto-detect. */
  installCommand?: string;
  buildCommand?: string;
  outputDir?: string;
  workerId?: string;
  fileCount?: number;
  totalBytes?: number;
  error?: string;
}

export type LogStream = 'stdout' | 'stderr' | 'system';

export interface LogLine {
  /** Monotonic sequence number per deployment (1-based). */
  n: number;
  /** Unix ms timestamp. */
  t: number;
  s: LogStream;
  m: string;
}

export interface WorkerInfo {
  id: string;
  hostname: string;
  pid: number;
  isolation: 'docker' | 'local';
  startedAt: number;
  busyWith: string | null;
  lastSeen: number;
}

export interface PlatformStats {
  total: number;
  byStatus: Record<DeploymentStatus, number>;
  successRate: number | null;
  avgBuildMs: number | null;
  queueLength: number;
}

export interface SystemHealth {
  database: boolean;
  redis: boolean;
  storage: boolean;
  storageDriver: 'fs' | 's3';
  workers: WorkerInfo[];
}

export type PlatformEvent =
  | { type: 'deployment.updated'; deployment: Deployment }
  | { type: 'deployment.deleted'; id: string };

export interface CreateDeploymentInput {
  repoUrl: string;
  branch?: string;
  installCommand?: string;
  buildCommand?: string;
  outputDir?: string;
}

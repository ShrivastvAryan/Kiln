/** Lifecycle of a deployment: cloning → queued → building → uploading → ready | failed | cancelled */
export type DeploymentStatus = 'cloning' | 'queued' | 'building' | 'uploading' | 'ready' | 'failed' | 'cancelled';

export const ACTIVE_STATUSES: DeploymentStatus[] = ['cloning', 'queued', 'building', 'uploading'];

export interface Deployment {
  id: string;
  /** User who created it (null for deployments made before auth existed). */
  ownerId?: string;
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
  /** Set while a ready deployment is paused (not served). */
  pausedAt?: number;
  /** Stable URL of the app this build belongs to (serves the app's latest live build). */
  appUrl?: string;
}

/** Where a running server build can be reached (stored in Redis under keys.runtime(id)). */
export interface RuntimeInfo {
  container: string;
  /** Port the app listens on inside its container. */
  port: number;
  /** Port published on the host's 127.0.0.1, for a router that runs outside Docker. */
  hostPort?: number;
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
  | { type: 'deployment.deleted'; id: string; ownerId?: string };

export interface CreateDeploymentInput {
  repoUrl: string;
  branch?: string;
  installCommand?: string;
  buildCommand?: string;
  outputDir?: string;
}

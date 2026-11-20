import { Redis } from 'ioredis';
import { config } from './config';

export const keys = {
  /** List used as a FIFO job queue (LPUSH / BRPOP). */
  queue: 'deployx:queue',
  /** Sorted set of deployment ids scored by createdAt. */
  index: 'deployx:deployments',
  deployment: (id: string) => `deployx:deployment:${id}`,
  logs: (id: string) => `deployx:logs:${id}`,
  logSeq: (id: string) => `deployx:logseq:${id}`,
  logChannel: (id: string) => `deployx:logs-ch:${id}`,
  logChannelPattern: 'deployx:logs-ch:*',
  events: 'deployx:events',
  worker: (id: string) => `deployx:worker:${id}`,
  workerPattern: 'deployx:worker:*',
  /** Pub/sub channel: a deployment id published here must stop building now. */
  cancel: 'deployx:cancel',
  /** Present while a deployment is paused; the router checks it on every request. */
  paused: (id: string) => `deployx:paused:${id}`,
  /** App slug → id of the app's latest live (ready) build; the router resolves app URLs through it. */
  alias: (slug: string) => `deployx:alias:${slug}`,
  /** Build id → JSON RuntimeInfo, present while that build runs as a server container; the router proxies to it. */
  runtime: (id: string) => `deployx:runtime:${id}`,
};

export function createRedis(name: string) {
  const client = new Redis(config.redisUrl, {
    connectionName: `deployx-${name}`,
    // Required for blocking commands (BRPOP) and subscribers so they never time out.
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
  let warned = false;
  client.on('error', (err) => {
    if (!warned) console.error(`[redis:${name}] ${err.message}`);
    warned = true;
  });
  client.on('ready', () => (warned = false));
  return client;
}

export type { Redis };

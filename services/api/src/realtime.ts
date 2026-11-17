import type { Request, Response } from 'express';
import { createRedis, keys } from '@deployx/shared';

/**
 * Server-Sent Events hub. A single Redis subscriber connection fans messages out to all
 * connected browsers, so the number of Redis connections stays constant regardless of viewers.
 */
export class RealtimeHub {
  private sub = createRedis('api-sub');
  private eventClients = new Set<Response>();
  private logClients = new Map<string, Set<Response>>();

  async start() {
    // Subscribing before the connection is ready races ioredis' ready-check (INFO), which is
    // illegal in subscriber mode and leaves the client with zero subscriptions. Wait first;
    // ioredis re-subscribes automatically on later reconnects.
    if (this.sub.status !== 'ready') await new Promise((resolve) => this.sub.once('ready', resolve));
    await this.sub.subscribe(keys.events);
    await this.sub.psubscribe(keys.logChannelPattern);

    this.sub.on('message', (_channel: string, message: string) => {
      for (const res of this.eventClients) send(res, 'event', message);
    });
    this.sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      const id = channel.slice(keys.logChannel('').length);
      const clients = this.logClients.get(id);
      if (clients) for (const res of clients) send(res, 'log', message);
    });

    // Heartbeats keep proxies from closing idle connections.
    setInterval(() => {
      for (const res of this.eventClients) res.write(': ping\n\n');
      for (const set of this.logClients.values()) for (const res of set) res.write(': ping\n\n');
    }, 15_000).unref();
  }

  addEventClient(req: Request, res: Response) {
    open(res);
    this.eventClients.add(res);
    req.on('close', () => this.eventClients.delete(res));
  }

  /** Subscribes first, then replays history: clients de-dupe by sequence number. */
  async addLogClient(req: Request, res: Response, id: string, history: () => Promise<unknown[]>) {
    open(res);
    let set = this.logClients.get(id);
    if (!set) this.logClients.set(id, (set = new Set()));
    set.add(res);
    req.on('close', () => {
      set!.delete(res);
      if (set!.size === 0) this.logClients.delete(id);
    });
    send(res, 'history', JSON.stringify(await history()));
  }

  get connections() {
    let logs = 0;
    for (const set of this.logClients.values()) logs += set.size;
    return { events: this.eventClients.size, logs };
  }
}

function open(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');
}

function send(res: Response, event: string, data: string) {
  res.write(`event: ${event}\ndata: ${data}\n\n`);
}

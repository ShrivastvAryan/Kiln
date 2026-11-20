import http from 'node:http';
import type { Duplex } from 'node:stream';
import { config, type RuntimeInfo } from '@deployx/shared';

/** Where to send a request for a running server build. */
export function upstream(info: RuntimeInfo) {
  if (config.runtime.upstream === 'container') return { host: info.container, port: info.port };
  return info.hostPort ? { host: '127.0.0.1', port: info.hostPort } : null;
}

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function forwardHeaders(req: http.IncomingMessage) {
  const headers: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.has(k) && v !== undefined) headers[k] = v;
  const ip = req.socket.remoteAddress ?? '';
  headers['x-forwarded-for'] = req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${ip}` : ip;
  headers['x-forwarded-host'] = req.headers.host ?? '';
  headers['x-forwarded-proto'] = 'http';
  return headers;
}

/** Streams one request to the app and its response back. Rejects if the app can't be reached. */
export function proxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  target: { host: string; port: number },
  id: string,
) {
  return new Promise<void>((resolve, reject) => {
    const upstreamReq = http.request(
      { host: target.host, port: target.port, method: req.method, path: req.url, headers: forwardHeaders(req) },
      (upstreamRes) => {
        const headers: http.OutgoingHttpHeaders = { ...upstreamRes.headers, 'x-kiln-id': id };
        for (const h of HOP_BY_HOP) delete headers[h]; // Node re-frames the body itself
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.statusMessage, headers);
        upstreamRes.pipe(res);
        upstreamRes.on('end', resolve);
        upstreamRes.on('error', reject);
      },
    );
    upstreamReq.on('error', reject);
    // Client went away: stop the upstream request too.
    res.on('close', () => {
      if (!res.writableFinished) upstreamReq.destroy();
      resolve();
    });
    req.pipe(upstreamReq);
  });
}

/** WebSocket (and other Upgrade) requests: open a raw TCP tunnel to the app after replaying the handshake. */
export function proxyUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer, target: { host: string; port: number }) {
  const upstreamReq = http.request({
    host: target.host,
    port: target.port,
    method: req.method,
    path: req.url,
    headers: { ...forwardHeaders(req), connection: 'Upgrade', upgrade: req.headers.upgrade ?? 'websocket' },
  });
  upstreamReq.on('upgrade', (upstreamRes, upstreamSocket, upstreamHead) => {
    const lines = [`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}`];
    for (let i = 0; i < upstreamRes.rawHeaders.length; i += 2)
      lines.push(`${upstreamRes.rawHeaders[i]}: ${upstreamRes.rawHeaders[i + 1]}`);
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    if (upstreamHead.length) socket.write(upstreamHead);
    if (head.length) upstreamSocket.write(head);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('error', () => upstreamSocket.destroy());
  });
  upstreamReq.on('response', (upstreamRes) => {
    // The app refused to upgrade: pass its answer through and close.
    socket.end(`HTTP/1.1 ${upstreamRes.statusCode} ${upstreamRes.statusMessage}\r\nConnection: close\r\n\r\n`);
  });
  upstreamReq.on('error', () => socket.destroy());
  upstreamReq.end();
}

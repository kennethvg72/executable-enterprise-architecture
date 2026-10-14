// A small router and request handling, on node:http (TS-02). Everything a typical internal
// application needs: routing with parameters, cookies, form bodies with a size limit,
// security headers, request IDs, a concurrency limit, logging and metrics.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from './log.ts';
import type { Metrics } from './metrics.ts';

export interface Request {
  method: string;
  path: string;
  url: URL;
  params: Record<string, string>;
  headers: IncomingMessage['headers'];
  cookies: Record<string, string>;
  requestId: string;
  log: Logger;
  /** The form body (application/x-www-form-urlencoded), size-limited. */
  form(): Promise<URLSearchParams>;
}

export interface Response {
  status: number;
  headers?: Record<string, string | string[]>;
  body?: string | Buffer;
}

export type Handler = (req: Request) => Promise<Response> | Response;

interface Route { method: string; pattern: string; parts: string[]; handler: Handler }

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function createRouter() {
  const routes: Route[] = [];
  const add = (method: string) => (pattern: string, handler: Handler) => {
    routes.push({ method, pattern, parts: pattern.split('/').filter(Boolean), handler });
  };
  const match = (method: string, path: string) => {
    const parts = path.split('/').filter(Boolean);
    let pathMatched = false;
    for (const r of routes) {
      if (r.parts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      const ok = r.parts.every((p, i) => {
        if (p.startsWith(':')) {
          // A malformed escape (%ZZ) is a request that matches nothing, not a crash.
          try { params[p.slice(1)] = decodeURIComponent(parts[i]!); } catch { return false; }
          return true;
        }
        return p === parts[i];
      });
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { route: r, params };
    }
    return pathMatched ? 'method-not-allowed' as const : undefined;
  };
  return { get: add('GET'), post: add('POST'), match };
}

export type Router = ReturnType<typeof createRouter>;

// ---- Responses

export const htmlResponse = (body: string, status = 200, headers: Record<string, string | string[]> = {}): Response =>
  ({ status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers }, body });
export const json = (value: unknown, status = 200): Response =>
  ({ status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
export const text = (body: string, status = 200): Response =>
  ({ status, headers: { 'content-type': 'text/plain; charset=utf-8' }, body });
export const redirect = (location: string, headers: Record<string, string | string[]> = {}): Response =>
  ({ status: 303, headers: { location, ...headers } });

// ---- Parsing

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    // Another application's malformed cookie is ignored, not a reason to fail the request.
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore */ }
  }
  return out;
}

const MAX_BODY_BYTES = 64 * 1024;

function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const type = req.headers['content-type'] ?? '';
    if (!type.startsWith('application/x-www-form-urlencoded')) {
      reject(new HttpError(415, 'Forms must be sent as application/x-www-form-urlencoded.'));
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      if (tooLarge) return; // keep draining, stop keeping
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        reject(new HttpError(413, 'Request body too large.'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!tooLarge) resolve(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))); });
    req.on('error', reject);
  });
}

/** The trace ID from a W3C traceparent header, or a new ID (OBS-05). */
export function requestIdFrom(traceparent: string | undefined): string {
  const m = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/.exec(traceparent ?? '');
  return m ? m[1]! : randomUUID().replaceAll('-', '');
}

// ---- Security headers (TS-07)

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
};

/**
 * Turn a router into a node:http request listener, with a concurrency limit (RES-08),
 * logging, metrics and security headers. Errors never leak details to users.
 */
export function createListener(router: Router, options: { log: Logger; metrics: Metrics; maxConcurrent: number; secure: boolean }) {
  const { log, metrics, maxConcurrent } = options;
  let inFlight = 0;
  const requests = metrics.counter('http_requests_total', 'HTTP requests by route and status.', ['route', 'status']);
  const duration = metrics.histogram('http_request_duration_seconds', 'HTTP request duration by route.', ['route']);
  metrics.gauge('http_requests_in_flight', 'Requests being handled right now.', () => inFlight);

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const started = performance.now();
    const requestId = requestIdFrom(req.headers.traceparent as string | undefined);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const method = req.method ?? 'GET';
    const found = router.match(method, url.pathname);
    const route = typeof found === 'object' ? found.route.pattern : 'unmatched';
    const reqLog = log.child({ requestId });

    const send = (r: Response) => {
      res.writeHead(r.status, { ...SECURITY_HEADERS, 'cache-control': 'no-store', ...r.headers });
      res.end(r.body);
      const seconds = (performance.now() - started) / 1000;
      requests.inc({ route, status: String(r.status) });
      duration.observe({ route }, seconds);
      reqLog[r.status >= 500 ? 'error' : 'info']('request', { method, route, status: r.status, ms: Math.round(seconds * 1000) });
    };

    // Health checks are exempt from the limit: a busy instance is still a healthy one, and
    // failing readiness under load would take every instance out of rotation at once.
    const health = url.pathname.startsWith('/health/');
    if (!health && inFlight >= maxConcurrent) {
      send({ ...text('Busy. Please try again in a moment.', 503), headers: { 'retry-after': '2', 'content-type': 'text/plain' } });
      return;
    }
    inFlight++;
    try {
      if (!found) return send(text('Not found.', 404));
      if (found === 'method-not-allowed') return send(text('Method not allowed.', 405));
      let form: Promise<URLSearchParams> | undefined;
      const request: Request = {
        method, path: url.pathname, url, params: found.params, headers: req.headers,
        cookies: parseCookies(req.headers.cookie), requestId, log: reqLog,
        form: () => (form ??= readForm(req)), // read once; the CSRF check and the handler share it
      };
      send(await found.route.handler(request));
    } catch (err) {
      if (err instanceof HttpError) {
        const r = text(err.message, err.status);
        send(err.status === 413 ? { ...r, headers: { ...r.headers, connection: 'close' } } : r);
      } else {
        reqLog.error('unhandled error', { method, route, err });
        send(text(`Something went wrong. Reference: ${requestId}`, 500));
      }
    } finally {
      inFlight--;
    }
  };

  // Last resort: an unexpected error must never take the process down with it.
  return (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((err: unknown) => {
      log.error('request handling failed', { err });
      if (!res.headersSent) res.writeHead(500, SECURITY_HEADERS).end();
      else res.destroy();
    });
  };
}

// Composes the application: routes, health, metrics, sign-in. No globals, so tests can
// start as many instances as they like.

import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createAuth } from './auth.ts';
import type { Config } from './config.ts';
import { databaseReachable, type Pool } from './db.ts';
import { createHealth } from './health.ts';
import { html, page } from './html.ts';
import { createListener, createRouter, htmlResponse, json } from './http.ts';
import type { Logger } from './log.ts';
import { createMetrics, type Metrics } from './metrics.ts';

export const APP_NAME = 'My application';
const CSS = readFileSync(join(import.meta.dirname, '..', 'static', 'app.css'), 'utf8');

export interface Deps {
  config: Config;
  pool: Pool;
  log: Logger;
  metrics?: Metrics;
}

export function createApp(deps: Deps) {
  const { config, pool, log } = deps;
  const metrics = deps.metrics ?? createMetrics();
  const router = createRouter();
  const auth = createAuth({ pool, config, appName: APP_NAME });

  // Readiness checks only critical dependencies: architecture.yaml consumes with critical: true.
  // It uses a connection of its own: a busy pool is overload, not an unreachable database.
  const health = createHealth([{ name: 'database', run: () => databaseReachable(config.databaseUrl) }]);

  router.get('/health/live', () => json(health.live()));
  router.get('/health/ready', async () => {
    const r = await health.ready();
    return json(r, r.ready ? 200 : 503);
  });
  router.get('/static/app.css', () => ({ status: 200, headers: { 'content-type': 'text/css; charset=utf-8' }, body: CSS }));
  auth.routes(router);

  router.get('/', auth.protect(['user'], (_req, s) => htmlResponse(page({
    title: APP_NAME,
    user: s.user,
    csrf: s.csrf,
    body: html`<h1>Hello, ${s.user.name}</h1><p>This is the template. Replace this page with what the Problem Owner needs.</p>`,
  }))));

  const listener = createListener(router, { log, metrics, maxConcurrent: config.maxConcurrentRequests, secure: !!config.tls });
  const metricsListener = (req: IncomingMessage, res: ServerResponse) => {
    if (req.url !== '/metrics') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' }).end(metrics.render());
  };
  return { listener, metricsListener, metrics, router };
}

/** Start the application and metrics servers. Port 0 picks a free port (tests use this). */
export async function start(deps: Deps) {
  const { config, log } = deps;
  const app = createApp(deps);
  const server = config.tls
    ? createHttpsServer({ cert: readFileSync(config.tls.cert), key: readFileSync(config.tls.key), ...(config.tls.ca ? { ca: readFileSync(config.tls.ca) } : {}) }, app.listener)
    : createHttpServer(app.listener);
  // Metrics use the same workload certificate: only the network limits who can reach them,
  // and everything in transit is encrypted (SEC-04, OBS-02).
  const tlsOptions = config.tls ? { cert: readFileSync(config.tls.cert), key: readFileSync(config.tls.key), ...(config.tls.ca ? { ca: readFileSync(config.tls.ca) } : {}) } : undefined;
  const metricsServer = tlsOptions ? createHttpsServer(tlsOptions, app.metricsListener) : createHttpServer(app.metricsListener);
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  await new Promise<void>((resolve) => metricsServer.listen(config.metricsPort, config.host, resolve));
  const port = (server.address() as AddressInfo).port;
  const metricsPort = (metricsServer.address() as AddressInfo).port;
  log.info('started', { port, metricsPort, tls: !!config.tls });
  return {
    port,
    metricsPort,
    app,
    async close() {
      await Promise.all([
        new Promise((r) => server.close(r)),
        new Promise((r) => metricsServer.close(r)),
      ]);
      server.closeAllConnections();
    },
  };
}

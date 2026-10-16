// Runs inside the load balancer authority's network namespace (authority-run.ts): stub backends
// that HAProxy checks and forwards to, and clients that observe what HAProxy does.
//
//   node authority-stubs.ts stubs <state.json> <certs dir>     prints "ready", serves until killed
//   node authority-stubs.ts client <requests.json>             JSON results
//   node authority-stubs.ts hold <src> <address> <port> <ms>   JSON { first, closedAfterMs }
//
// state.json: { apps: [{ addr, port, healthPort, host, cert: "good" | "wrong" }], dbs: [{ addr, port, apiPort, host }],
//               ready: { <addr>: boolean }, primaries: [<addr>, ...] }   (re-read on every request)

import { readFileSync } from 'node:fs';
import { createServer as createHttps, request } from 'node:https';
import { connect, createServer } from 'node:net';
import { join } from 'node:path';

interface State {
  apps: { addr: string; port: number; healthPort: number; host: string; cert: 'good' | 'wrong' }[];
  dbs: { addr: string; port: number; apiPort: number; host: string }[];
  ready: Record<string, boolean>;
  primaries: string[];
}

const [mode, ...args] = process.argv.slice(2);

if (mode === 'stubs') {
  const [stateFile, certs] = args as [string, string];
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8')) as State;
  const tls = (name: string) => ({ key: readFileSync(join(certs, `${name}.key`)), cert: readFileSync(join(certs, `${name}.crt`)) });
  const servers: Promise<void>[] = [];
  const listen = (srv: { listen: (port: number, host: string, cb: () => void) => unknown }, port: number, host: string) =>
    servers.push(new Promise((r) => { srv.listen(port, host, r); }));
  for (const app of state().apps) {
    const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
      if (req.url === '/health/ready') { const ok = state().ready[app.addr] !== false; res.writeHead(ok ? 200 : 503).end(ok ? 'ready' : 'not ready'); return; }
      res.writeHead(200).end(`served-by ${app.addr}`);
    };
    const cert = tls(app.cert === 'good' ? app.host : 'wrong.natax.internal');
    listen(createHttps(cert, handler), app.port, app.addr);
    if (app.healthPort !== app.port) listen(createHttps(cert, handler), app.healthPort, app.addr);
  }
  for (const db of state().dbs) {
    // Patroni's API: /primary answers 200 only on the primary.
    listen(createHttps(tls(db.host), (req, res) => {
      const primary = state().primaries.includes(db.addr);
      res.writeHead(req.url === '/primary' && primary ? 200 : 503).end();
    }), db.apiPort, db.addr);
    // The database: says which node it is, then keeps the connection open.
    listen(createServer((s) => { s.write(`node ${db.addr}\n`); s.on('error', () => {}); }), db.port, db.addr);
  }
  await Promise.all(servers);
  console.log('ready');
} else if (mode === 'client') {
  const reqs = JSON.parse(readFileSync(args[0]!, 'utf8')) as { src: string; vip: string; host: string; path: string; ca: string }[];
  const results = await Promise.all(reqs.map((r) => new Promise<{ status: number; body: string }>((resolve) => {
    const req = request({ host: r.vip, port: 443, path: r.path, localAddress: r.src, servername: r.host, headers: { host: r.host }, ca: readFileSync(r.ca), timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: body.trim() }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.end();
  })));
  console.log(JSON.stringify(results));
} else if (mode === 'hold') {
  const [src, address, port, ms] = args as [string, string, string, string];
  const started = Date.now();
  const out = await new Promise<{ first: string; closedAfterMs: number | null }>((resolve) => {
    let first = '';
    const s = connect({ host: address, port: Number(port), localAddress: src });
    const timer = setTimeout(() => { s.destroy(); resolve({ first, closedAfterMs: null }); }, Number(ms));
    s.on('data', (d) => { if (!first) { first = d.toString().trim(); console.error('connected'); } });
    s.on('close', () => { clearTimeout(timer); resolve({ first, closedAfterMs: Date.now() - started }); });
    s.on('error', () => {});
  });
  console.log(JSON.stringify(out));
} else {
  console.error('Usage: authority-stubs.ts stubs <state> <certs> | client <requests> | hold <src> <address> <port> <ms>');
  process.exit(2);
}

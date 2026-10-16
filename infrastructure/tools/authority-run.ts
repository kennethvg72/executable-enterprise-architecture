// The load balancer authority's run (DEL-06), on Linux as root: the generated HAProxy configuration
// runs in real HAProxy, in a network namespace, against stub backends with test certificates, and
// its behavior is observed, through requests and through its stats socket (the effective state
// after defaults and overrides). The only changes to the configuration: file paths pointed at the
// test's certificates, and a stats socket to observe it.
//
// Input: a directory prepared by authority.ts (plan.json and the configuration). Output: JSON.
// Usage (as root): node infrastructure/tools/authority-run.ts <dir>

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

export interface SitePlan {
  site: string; vip: string; config: string;
  app: { id: string; host: string; port: number; healthPort: number; local: string; remote: string; localServer: string; remoteServer: string };
  sources: { consumer: string; unlisted: string; otherHost: string };
  dbs: { id: string; frontendPort: number; nodes: { addr: string; port: number; apiPort: number; host: string; site: string }[] }[];
}
export interface Finding { site: string; scenario: string; ok: boolean; detail: string }

const STUBS = join(import.meta.dirname, 'authority-stubs.ts');
const NS = 'lbauth';
const inNs = (...args: string[]) => execFileSync('ip', ['netns', 'exec', NS, ...args], { stdio: 'pipe' }).toString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function certificates(dir: string, hosts: string[]) {
  const c = join(dir, 'certs');
  mkdirSync(c, { recursive: true });
  const ssl = (...args: string[]) => execFileSync('openssl', args, { stdio: 'pipe', cwd: c });
  ssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '2', '-subj', '/CN=authority-test-ca');
  for (const h of [...new Set([...hosts, 'wrong.natax.internal', '*.natax.internal'])]) {
    const name = h.replace('*', 'wildcard');
    writeFileSync(join(c, `${name}.ext`), `subjectAltName=DNS:${h}\n`);
    ssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${name}.key`, '-out', `${name}.csr`, '-subj', `/CN=${h}`);
    ssl('x509', '-req', '-in', `${name}.csr`, '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', `${name}.crt`, '-days', '2', '-extfile', `${name}.ext`);
  }
  // HAProxy's frontend reads a directory of combined certificate files.
  mkdirSync(join(dir, 'fe'), { recursive: true });
  writeFileSync(join(dir, 'fe', 'frontend.pem'), readFileSync(join(c, 'wildcard.natax.internal.crt'), 'utf8') + readFileSync(join(c, 'wildcard.natax.internal.key'), 'utf8'));
}

function waitForLine(child: ChildProcess, stream: 'stdout' | 'stderr', text: string, ms = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`no "${text}" within ${ms} ms: ${out.slice(-300)}`)), ms);
    child[stream]!.on('data', (d) => { out += d; if (out.includes(text)) { clearTimeout(timer); resolve(); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`exited (${code}): ${out.slice(-300)}`)); });
  });
}

/** HAProxy's own view of a server, through the stats socket. */
function serverStatus(sock: string, backend: string, server: string): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    const s = connect(sock, () => s.write('show stat\n'));
    s.on('data', (d) => { out += d; });
    s.on('end', () => {
      const [head, ...rows] = out.trim().split('\n');
      const cols = head!.replace(/^# /, '').split(',');
      const row = rows.map((r) => r.split(',')).find((r) => r[0] === backend && r[1] === server);
      resolve(row ? row[cols.indexOf('status')]! : 'missing');
    });
    s.on('error', () => resolve('no socket'));
  });
}

async function until(check: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await sleep(500); }
  return check();
}

async function testSite(plan: SitePlan, dir: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const note = (scenario: string, ok: boolean, detail: string) => findings.push({ site: plan.site, scenario, ok, detail });
  const sock = join(dir, `admin-${plan.site}.sock`);
  const config = join(dir, `run-${plan.site}.cfg`);
  writeFileSync(config, readFileSync(plan.config, 'utf8')
    .replaceAll('/etc/haproxy/certs/', `${join(dir, 'fe')}/`)
    .replaceAll('/etc/haproxy/ca/natax-workload-ca.pem', join(dir, 'certs', 'ca.crt'))
    .replace(/^global\n/m, `global\n  stats socket ${sock} mode 600 level admin\n`));
  const syntax = spawnSync('haproxy', ['-c', '-f', config], { encoding: 'utf8' });
  note('the configuration loads (haproxy -c)', syntax.status === 0, (syntax.stdout + syntax.stderr).trim().split('\n').slice(-2).join(' '));
  if (syntax.status !== 0) return findings;

  spawnSync('ip', ['netns', 'delete', NS], { stdio: 'ignore' });
  execFileSync('ip', ['netns', 'add', NS]);
  const children: ChildProcess[] = [];
  try {
    inNs('ip', 'link', 'set', 'lo', 'up');
    inNs('ip', 'link', 'add', 'd0', 'type', 'dummy');
    inNs('ip', 'link', 'set', 'd0', 'up');
    const { app, dbs, sources } = plan;
    const nodes = dbs.flatMap((d) => d.nodes);
    for (const a of new Set([plan.vip, app.local, app.remote, ...nodes.map((n) => n.addr), sources.consumer, sources.unlisted])) inNs('ip', 'addr', 'add', `${a}/32`, 'dev', 'd0');
    const stateFile = join(dir, `state-${plan.site}.json`);
    const state = { apps: [
      { addr: app.local, port: app.port, healthPort: app.healthPort, host: app.host, cert: 'good' },
      { addr: app.remote, port: app.port, healthPort: app.healthPort, host: app.host, cert: 'wrong' },
    ], dbs: nodes, ready: {} as Record<string, boolean>, primaries: dbs.map((d) => d.nodes.find((n) => n.site === plan.site)!.addr) };
    const save = () => writeFileSync(stateFile, JSON.stringify(state));
    const startStubs = async () => {
      const s = spawn('ip', ['netns', 'exec', NS, process.execPath, STUBS, 'stubs', stateFile, join(dir, 'certs')], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(s);
      await waitForLine(s, 'stdout', 'ready');
      return s;
    };
    save();
    let stubs = await startStubs();
    const haproxy = spawn('ip', ['netns', 'exec', NS, 'haproxy', '-f', config, '-db'], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(haproxy);
    await until(async () => (await serverStatus(sock, app.id, app.localServer)) !== 'no socket', 10000);

    const ask = (src: string, host: string, path = '/') => {
      const file = join(dir, `req-${plan.site}.json`);
      writeFileSync(file, JSON.stringify([{ src, vip: plan.vip, host, path, ca: join(dir, 'certs', 'ca.crt') }]));
      return (JSON.parse(inNs(process.execPath, STUBS, 'client', file)) as { status: number; body: string }[])[0]!;
    };
    let r = ask(sources.consumer, app.host, '/health/ready');
    note('clients can\'t call /health/* through the load balancer', r.status === 404, `status ${r.status}`);
    r = ask(sources.unlisted, app.host);
    note('a source that consumes nothing here may name nothing', r.status === 403, `status ${r.status}`);
    r = ask(sources.consumer, sources.otherHost);
    note('a consumer may name only its own applications', r.status === 403, `status ${r.status} for ${sources.otherHost}`);
    // A backend whose certificate isn't for its name is marked DOWN, not trusted.
    const badDown = await until(async () => (await serverStatus(sock, app.id, app.remoteServer)) === 'DOWN', 15000);
    const localUp = (await serverStatus(sock, app.id, app.localServer)) === 'UP';
    note('a backend with the wrong certificate is marked DOWN', badDown && localUp, `${app.remoteServer}: ${await serverStatus(sock, app.id, app.remoteServer)}, ${app.localServer}: ${await serverStatus(sock, app.id, app.localServer)}`);

    // Good certificates everywhere: the other datacenter is a backup, used only when this one is down.
    stubs.kill(); await sleep(300);
    state.apps[1]!.cert = 'good'; save();
    stubs = await startStubs();
    const bothUp = await until(async () => (await serverStatus(sock, app.id, app.remoteServer)) === 'UP', 15000);
    const served = [0, 1, 2, 3, 4].map(() => ask(sources.consumer, app.host).body);
    note('while this datacenter is up, its own instances serve', bothUp && served.every((b) => b === `served-by ${app.local}`), `${served.join(', ')}`);
    state.ready[app.local] = false; save();
    const localDown = await until(async () => (await serverStatus(sock, app.id, app.localServer)) === 'DOWN', 15000);
    r = ask(sources.consumer, app.host);
    note('when its instances aren\'t ready, the other datacenter serves', localDown && r.body === `served-by ${app.remote}`, `${app.localServer} ${localDown ? 'DOWN' : 'still UP'}; ${r.body}`);

    // Every database endpoint follows its primary, and cuts connections to a demoted one. Each one:
    // a check that observes one example of a pattern proves nothing about the others.
    for (const db of dbs) {
      const localDb = db.nodes.find((n) => n.site === plan.site)!;
      const remoteDb = db.nodes.find((n) => n.site !== plan.site)!;
      const hold = spawn('ip', ['netns', 'exec', NS, process.execPath, STUBS, 'hold', sources.consumer, plan.vip, String(db.frontendPort), '20000'], { stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(hold);
      let held = '';
      hold.stdout!.on('data', (d) => { held += d; });
      const connected = await waitForLine(hold, 'stderr', 'connected', 15000).then(() => true, () => false);
      state.primaries = state.primaries.map((x) => (x === localDb.addr ? remoteDb.addr : x)); save();
      await new Promise((r2) => hold.once('exit', r2));
      const h = held ? JSON.parse(held) as { first: string; closedAfterMs: number | null } : { first: '', closedAfterMs: null };
      note(`${db.id}: connections go to the primary, and are cut when it is demoted`, connected && h.first === `node ${localDb.addr}` && h.closedAfterMs !== null,
        `first: ${h.first || 'nothing'}; ${h.closedAfterMs === null ? 'never cut' : `cut after ${h.closedAfterMs} ms`}`);
      const follows = await until(async () => {
        const once = spawnSync('ip', ['netns', 'exec', NS, process.execPath, STUBS, 'hold', sources.consumer, plan.vip, String(db.frontendPort), '1500'], { encoding: 'utf8' });
        try { return (JSON.parse(once.stdout) as { first: string }).first === `node ${remoteDb.addr}`; } catch { return false; }
      }, 15000);
      note(`${db.id}: new connections go to the new primary`, follows, follows ? `node ${remoteDb.addr}` : 'still not the new primary');
    }
  } catch (e) {
    note('the run completed', false, (e as Error).message.split('\n')[0]!);
  } finally {
    for (const c of children) c.kill();
    await sleep(300);
    spawnSync('ip', ['netns', 'delete', NS], { stdio: 'ignore' });
  }
  return findings;
}

if (import.meta.main) {
  const dir = process.argv[2]!;
  const plans = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')) as SitePlan[];
  certificates(dir, plans.flatMap((p) => [p.app.host, ...p.dbs.flatMap((d) => d.nodes.map((n) => n.host))]));
  const findings: Finding[] = [];
  for (const p of plans) findings.push(...await testSite(p, dir));
  console.log(JSON.stringify(findings));
}

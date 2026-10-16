// The network authority's run (DEL-06), on Linux as root: every generated ruleset is loaded into
// real nftables in a network namespace, and the intent is tested against what the kernel does.
//
// For each host (one instance per site), namespace H holds that host's addresses and its ruleset;
// namespace W holds every address it talks to, without rules, and listens on their ports. Probes
// from W into H test H's input chain; probes from H out to W test its output chain. The HQ router
// gets three namespaces: DC1's side, DC2's side, and the router between them with its ruleset.
//
// Input: a directory prepared by authority.ts (plan.json and the rulesets). Output: JSON on stdout.
// Usage (as root): node network/tools/authority-run.ts <dir>

import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Attempt { src: string; dst: string; port: number; protocol: 'tcp' | 'udp'; expect: 'open' | 'blocked'; label: string }
export interface HostUnit { id: string; ruleset: string; addresses: string[]; attempts: Attempt[] }
export interface Plan { hosts: HostUnit[]; transit?: { ruleset: string; dc1: string[]; dc2: string[]; attempts: Attempt[] } }
export interface Mismatch extends Attempt { host: string; direction: 'in' | 'out' | 'transit'; actual: 'open' | 'blocked' }

const HELPER = join(import.meta.dirname, 'authority-helper.ts');
const ip = (...args: string[]) => execFileSync('ip', args, { stdio: 'pipe' });
const inNs = (ns: string, ...args: string[]) => execFileSync('ip', ['netns', 'exec', ns, ...args], { stdio: 'pipe' });

function cleanup(names: string[]) {
  for (const n of names) spawnSync('ip', ['netns', 'delete', n], { stdio: 'ignore' });
}

/** Starts listeners in a namespace and waits until they are up. */
function listen(ns: string, tcp: number[], udp: { addr: string; port: number }[]): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn('ip', ['netns', 'exec', ns, process.execPath, HELPER, 'listen', [...new Set(tcp)].join(','), [...new Set(udp.map((u) => `${u.addr}:${u.port}`))].join(',')], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout!.on('data', (d) => { out += d; if (out.includes('ready')) resolve(child); });
    child.stderr!.on('data', (d) => { out += d; });
    child.once('exit', (code) => reject(new Error(`listener in ${ns} exited (${code}): ${out}`)));
  });
}

function probe(ns: string, dir: string, attempts: Attempt[]): boolean[] {
  if (!attempts.length) return [];
  const file = join(dir, `attempts-${ns}.json`);
  writeFileSync(file, JSON.stringify(attempts.map(({ src, dst, port, protocol }) => ({ src, dst, port, protocol }))));
  return JSON.parse(inNs(ns, process.execPath, HELPER, 'probe', file).toString()) as boolean[];
}

/** Two namespaces joined by a veth pair, each holding its addresses, routing everything to the other. */
function pair(a: string, aAddrs: string[], b: string, bAddrs: string[]) {
  cleanup([a, b]);
  ip('netns', 'add', a); ip('netns', 'add', b);
  ip('link', 'add', `${a}-v`, 'type', 'veth', 'peer', 'name', `${b}-v`);
  ip('link', 'set', `${a}-v`, 'netns', a); ip('link', 'set', `${b}-v`, 'netns', b);
  for (const [ns, dev, addrs] of [[a, `${a}-v`, aAddrs], [b, `${b}-v`, bAddrs]] as const) {
    inNs(ns, 'ip', 'link', 'set', 'lo', 'up');
    inNs(ns, 'ip', 'link', 'set', dev, 'up');
    for (const addr of new Set(addrs)) inNs(ns, 'ip', 'addr', 'add', `${addr}/32`, 'dev', dev);
    inNs(ns, 'ip', 'route', 'add', 'default', 'dev', dev);
  }
}

async function testHost(unit: HostUnit, dir: string): Promise<{ tested: number; mismatches: Mismatch[] }> {
  const h = 'nh', w = 'nw';
  const mine = new Set(unit.addresses);
  const inbound = unit.attempts.filter((x) => mine.has(x.dst) && !mine.has(x.src));
  const outbound = unit.attempts.filter((x) => mine.has(x.src) && !mine.has(x.dst));
  const others = [...inbound.map((x) => x.src), ...outbound.map((x) => x.dst)];
  pair(h, unit.addresses, w, others);
  const listeners: ChildProcess[] = [];
  try {
    inNs(h, 'nft', '-f', unit.ruleset);
    listeners.push(await listen(h, inbound.filter((x) => x.protocol === 'tcp').map((x) => x.port), inbound.filter((x) => x.protocol === 'udp').map((x) => ({ addr: x.dst, port: x.port }))));
    listeners.push(await listen(w, outbound.filter((x) => x.protocol === 'tcp').map((x) => x.port), outbound.filter((x) => x.protocol === 'udp').map((x) => ({ addr: x.dst, port: x.port }))));
    const mismatches: Mismatch[] = [];
    const check = (attempts: Attempt[], results: boolean[], direction: 'in' | 'out') => attempts.forEach((x, i) => {
      const actual = results[i] ? 'open' : 'blocked';
      if (actual !== x.expect) mismatches.push({ ...x, host: unit.id, direction, actual });
    });
    check(inbound, probe(w, dir, inbound), 'in');
    check(outbound, probe(h, dir, outbound), 'out');
    return { tested: inbound.length + outbound.length, mismatches };
  } finally {
    for (const l of listeners) l.kill();
    cleanup([h, w]);
  }
}

async function testTransit(t: NonNullable<Plan['transit']>, dir: string): Promise<{ tested: number; mismatches: Mismatch[] }> {
  const a = 'na', b = 'nb', r = 'nr';
  cleanup([a, b, r]);
  for (const n of [a, b, r]) ip('netns', 'add', n);
  ip('link', 'add', 'na-v', 'type', 'veth', 'peer', 'name', 'nra-v');
  ip('link', 'add', 'nb-v', 'type', 'veth', 'peer', 'name', 'nrb-v');
  ip('link', 'set', 'na-v', 'netns', a); ip('link', 'set', 'nra-v', 'netns', r);
  ip('link', 'set', 'nb-v', 'netns', b); ip('link', 'set', 'nrb-v', 'netns', r);
  const side = (ns: string, dev: string, addrs: string[], gw: string) => {
    inNs(ns, 'ip', 'link', 'set', 'lo', 'up'); inNs(ns, 'ip', 'link', 'set', dev, 'up');
    for (const addr of new Set(addrs)) inNs(ns, 'ip', 'addr', 'add', `${addr}/32`, 'dev', dev);
    inNs(ns, 'ip', 'route', 'add', 'default', 'via', gw, 'dev', dev, 'onlink');
  };
  side(a, 'na-v', t.dc1, '169.254.0.1');
  side(b, 'nb-v', t.dc2, '169.254.0.2');
  inNs(r, 'ip', 'link', 'set', 'lo', 'up');
  for (const [dev, gw, addrs] of [['nra-v', '169.254.0.1', t.dc1], ['nrb-v', '169.254.0.2', t.dc2]] as const) {
    inNs(r, 'ip', 'link', 'set', dev, 'up');
    inNs(r, 'ip', 'addr', 'add', `${gw}/32`, 'dev', dev);
    for (const addr of new Set(addrs)) inNs(r, 'ip', 'route', 'add', `${addr}/32`, 'dev', dev);
  }
  inNs(r, 'sysctl', '-qw', 'net.ipv4.ip_forward=1');
  const listeners: ChildProcess[] = [];
  try {
    inNs(r, 'nft', '-f', t.ruleset);
    const toB = t.attempts.filter((x) => t.dc2.includes(x.dst));
    const toA = t.attempts.filter((x) => t.dc1.includes(x.dst));
    listeners.push(await listen(a, toA.filter((x) => x.protocol === 'tcp').map((x) => x.port), toA.filter((x) => x.protocol === 'udp').map((x) => ({ addr: x.dst, port: x.port }))));
    listeners.push(await listen(b, toB.filter((x) => x.protocol === 'tcp').map((x) => x.port), toB.filter((x) => x.protocol === 'udp').map((x) => ({ addr: x.dst, port: x.port }))));
    const mismatches: Mismatch[] = [];
    for (const [ns, attempts] of [[a, toB], [b, toA]] as const) {
      probe(ns, dir, attempts).forEach((open, i) => {
        const x = attempts[i]!;
        const actual = open ? 'open' : 'blocked';
        if (actual !== x.expect) mismatches.push({ ...x, host: 'hq-router', direction: 'transit', actual });
      });
    }
    return { tested: t.attempts.length, mismatches };
  } finally {
    for (const l of listeners) l.kill();
    cleanup([a, b, r]);
  }
}

if (import.meta.main) {
  const dir = process.argv[2]!;
  const plan = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8')) as Plan;
  const out = { tested: 0, transit: 0, mismatches: [] as Mismatch[], errors: [] as string[] };
  for (const unit of plan.hosts) {
    try {
      const r = await testHost(unit, dir);
      out.tested += r.tested;
      out.mismatches.push(...r.mismatches);
    } catch (e) {
      out.errors.push(`${unit.id}: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  if (plan.transit) {
    try {
      const r = await testTransit(plan.transit, dir);
      out.transit = r.tested;
      out.mismatches.push(...r.mismatches);
    } catch (e) {
      out.errors.push(`hq-router: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  console.log(JSON.stringify(out));
}

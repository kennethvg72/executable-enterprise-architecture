// Runs the probes in the probe plan that start from this host, and reports every probe whose
// outcome differs from what the policy says. No AI involved: a probe either connects or not.
//
// Usage, on a host or vantage point in a lab or environment:
//   node network/tools/probe.ts --from 10.1.20.31 [--plan generated/probes.json] [--timeout 2000]
//
// A probe expected to be "blocked" passes if the connection times out (dropped by policy).
// "Refused" also means no connection, but proves the packet reached the host: the policy
// should have dropped it first, so it is reported as a warning.

import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT } from '../../enterprise-architecture/tools/lib/load.ts';
import type { Probe } from './render.ts';

type Outcome = 'open' | 'refused' | 'timeout' | 'error';

export function attempt(host: string, port: number, timeoutMs: number): Promise<Outcome> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (o: Outcome) => { socket.destroy(); resolve(o); };
    socket.setTimeout(timeoutMs, () => done('timeout'));
    socket.once('connect', () => done('open'));
    socket.once('error', (e: NodeJS.ErrnoException) => done(e.code === 'ECONNREFUSED' ? 'refused' : 'error'));
  });
}

export async function runProbes(probes: Probe[], timeoutMs: number, concurrency = 50) {
  const results: { probe: Probe; outcome: Outcome }[] = [];
  let next = 0;
  const worker = async () => {
    while (next < probes.length) {
      const probe = probes[next++]!;
      results.push({ probe, outcome: await attempt(probe.to, probe.port, timeoutMs) });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      plan: { type: 'string', default: join(REPO_ROOT, 'network', 'generated', 'probes.json') },
      timeout: { type: 'string', default: '2000' },
    },
  });
  if (!values.from) {
    console.error('Usage: node probe.ts --from <this host\'s address> [--plan probes.json] [--timeout ms]');
    process.exit(2);
  }
  const plan = (JSON.parse(readFileSync(values.plan!, 'utf8')) as Probe[]).filter((p) => p.from === values.from);
  if (!plan.length) {
    console.error(`No probes start from ${values.from}. Is it a vantage point in the plan?`);
    process.exit(2);
  }
  const results = await runProbes(plan, Number(values.timeout));
  const wrong = results.filter(({ probe, outcome }) => (probe.expect === 'open') !== (outcome === 'open'));
  const refused = results.filter(({ probe, outcome }) => probe.expect === 'blocked' && outcome === 'refused');
  // A blocked probe that times out proves nothing if the target host is simply down. Count it
  // only if something else from here reached the same host (a positive control).
  const alive = new Set(results.filter((r) => r.outcome === 'open' || r.outcome === 'refused').map((r) => r.probe.to));
  const inconclusive = results.filter(({ probe, outcome }) => probe.expect === 'blocked' && outcome === 'timeout' && !alive.has(probe.to));
  for (const { probe } of inconclusive) {
    console.log(`INCONCLUSIVE ${probe.fromLabel} -> ${probe.toLabel} ${probe.to}:${probe.port}: timed out, but nothing shows ${probe.to} is up`);
  }
  for (const { probe, outcome } of wrong) {
    console.log(`FAIL ${probe.fromLabel} -> ${probe.toLabel} ${probe.to}:${probe.port}: expected ${probe.expect}, got ${outcome}`);
  }
  for (const { probe } of refused) {
    console.log(`WARN ${probe.fromLabel} -> ${probe.toLabel} ${probe.to}:${probe.port}: refused, not dropped; check the host firewall`);
  }
  console.log(`${results.length} probes from ${values.from}: ${results.length - wrong.length - inconclusive.length} as expected, ${wrong.length} not, ${inconclusive.length} inconclusive.`);
  if (wrong.length) process.exitCode = 1;
}

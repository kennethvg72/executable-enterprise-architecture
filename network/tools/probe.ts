// Runs the probes in the probe plan that start from this host, and reports every probe whose
// outcome differs from what the policy says. No AI involved: a probe either connects or not.
//
// Usage, on a host or vantage point in a lab or environment:
//   node network/tools/probe.ts --from 10.1.20.31 [--plan generated/probes.json] [--timeout 2000]
//
// A probe expected to be "blocked" passes if the connection times out (dropped by policy).
// "Refused" also means no connection, but proves the packet reached the host: the policy
// should have dropped it first, so it is reported as a warning.
//
// Three outcomes, because absence of evidence is not evidence of compliance (ZTN-06):
//   PASS          every probe behaved as the policy says           exit 0
//   FAIL          at least one probe didn't                         exit 1
//   INCONCLUSIVE  no failures, but some "blocked" results prove      exit 3
//                 nothing, because nothing showed the target was up
// Only PASS lets a verification gate pass. And PASS is corroboration, not proof: a timeout next to
// a positive control is consistent with the firewall dropping it, but another device could have
// done the same. Proof that the rules are right comes from reading them back (DEL-06, nft.ts);
// probes show that reality agrees. Neither is enough on its own.

import { connect } from 'node:net';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT } from '../../enterprise-architecture/tools/lib/load.ts';
import type { Probe } from './render.ts';

export type Outcome = 'open' | 'refused' | 'timeout' | 'error';

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

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

/** The targets a set of results shows to be up: something reached them (open), or they answered (refused). */
export const reached = (results: { probe: Probe; outcome: Outcome }[]) =>
  new Set(results.filter((r) => r.outcome === 'open' || r.outcome === 'refused').map((r) => r.probe.to));

/**
 * A blocked probe that times out or errors proves nothing if the target host is simply down. It
 * counts only with evidence, from the same run window, that the target was up: this vantage
 * reached it, another vantage did (probe-report.ts), or monitoring saw it (--alive).
 */
export function classify(results: { probe: Probe; outcome: Outcome }[], evidence: Set<string> = new Set()) {
  const wrong = results.filter(({ probe, outcome }) => (probe.expect === 'open') !== (outcome === 'open'));
  const refused = results.filter(({ probe, outcome }) => probe.expect === 'blocked' && outcome === 'refused');
  const alive = new Set([...reached(results), ...evidence]);
  const inconclusive = results.filter(({ probe, outcome }) => probe.expect === 'blocked' && (outcome === 'timeout' || outcome === 'error') && !alive.has(probe.to));
  const verdict: Verdict = wrong.length ? 'FAIL' : inconclusive.length ? 'INCONCLUSIVE' : 'PASS';
  return { verdict, wrong, refused, inconclusive };
}

export const EXIT_CODE: Record<Verdict, number> = { PASS: 0, FAIL: 1, INCONCLUSIVE: 3 };

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      plan: { type: 'string', default: join(REPO_ROOT, 'network', 'generated', 'probes.json') },
      timeout: { type: 'string', default: '2000' },
      // Liveness evidence from outside this vantage: a JSON list of addresses monitoring saw up.
      alive: { type: 'string' },
      // The raw results, for probe-report.ts to combine with the other vantages'.
      out: { type: 'string' },
    },
  });
  if (!values.from) {
    console.error('Usage: node probe.ts --from <this host\'s address> [--plan probes.json] [--timeout ms] [--alive monitoring-up.json] [--out results.json]');
    process.exit(2);
  }
  const plan = (JSON.parse(readFileSync(values.plan!, 'utf8')) as Probe[]).filter((p) => p.from === values.from);
  if (!plan.length) {
    console.error(`No probes start from ${values.from}. Is it a vantage point in the plan?`);
    process.exit(2);
  }
  const started = new Date().toISOString();
  const results = await runProbes(plan, Number(values.timeout));
  if (values.out) writeFileSync(values.out, JSON.stringify({ from: values.from, started, finished: new Date().toISOString(), results }, null, 0));
  const evidence = new Set<string>(values.alive ? JSON.parse(readFileSync(values.alive, 'utf8')) as string[] : []);
  const { verdict, wrong, refused, inconclusive } = classify(results, evidence);
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
  console.log(verdict === 'INCONCLUSIVE'
    ? 'INCONCLUSIVE: no failures, but not proven. Bring the targets up, or run from a vantage point that can see them, and probe again.'
    : verdict);
  process.exitCode = EXIT_CODE[verdict];
}

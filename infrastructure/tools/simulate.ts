// Deterministic failure simulation of the NATAX topology: for each scenario, which sites
// have quorum, where the database primary ends up, whether it still has a synchronous
// replica, and which datacenters can still serve. This tests the DESIGN. The failover
// exercises (RES-09) test the real thing.
//
// Usage: node infrastructure/tools/simulate.ts [--markdown]

import { loadLandscape, clone } from '../../enterprise-architecture/tools/lib/load.ts';
import type { Landscape } from '../../enterprise-architecture/tools/lib/model.ts';
import { components, type Edge, topology } from './topology.ts';

export interface Scenario {
  name: string;
  sitesDown?: string[];
  linksDown?: Edge[];
  /** Model the witness as reachable over the internet instead of in-band. */
  outOfBandWitness?: boolean;
  /** Where the database primary is before the failure. */
  primaryBefore?: string;
}

export type Verdict = 'ok' | 'degraded' | 'outage' | 'danger';

export interface Outcome {
  scenario: string;
  quorum: string[];           // sites whose voting member is part of a majority
  primary: string | null;     // where the primary is after automatic failover
  syncReplica: boolean;       // does the primary still have a synchronous replica?
  serving: string[];          // datacenters whose applications can reach the primary
  verdict: Verdict;
  explanation: string;
}

const DCS = ['dc1', 'dc2'];

export function outOfBand(landscape: Landscape): Landscape {
  const l = clone(landscape);
  for (const link of l.links) {
    if (link.between.includes('hq') && link.between.some((s) => DCS.includes(s))) link.network = 'internet-vpn';
  }
  return l;
}

export function simulate(landscape: Landscape, s: Scenario): Outcome {
  const l = s.outOfBandWitness ? outOfBand(landscape) : landscape;
  const t = topology(l);
  const up = new Set(t.sites.filter((x) => !(s.sitesDown ?? []).includes(x)));
  const down = (e: Edge) => (s.linksDown ?? []).some((d) => d.includes(e[0]) && d.includes(e[1]));
  const data = t.data.filter((e) => !down(e));
  const quorumEdges = t.quorum.filter((e) => !down(e));

  const votingSites = ['dc1', 'dc2', 'hq'];
  const quorumGroups = components(t.sites, quorumEdges, up, t.transit);
  const dataGroups = components(t.sites, data, up, t.transit);
  const reachable = (groups: string[][], a: string, b: string) => a === b || groups.some((g) => g.includes(a) && g.includes(b));

  // A voting site has quorum if it can reach a majority of voting sites (itself included).
  const quorum = votingSites.filter((v) => up.has(v) && votingSites.filter((w) => up.has(w) && reachable(quorumGroups, v, w)).length >= 2);

  const before = s.primaryBefore ?? 'dc1';
  const replicaSite = DCS.find((d) => d !== before)!;
  let primary: string | null = null;
  let explanation = '';
  if (up.has(before) && quorum.includes(before)) {
    primary = before;
  } else if (up.has(replicaSite) && quorum.includes(replicaSite)) {
    primary = replicaSite; // the synchronous replica is promoted; the old primary is fenced by its watchdog
    explanation = `The primary in ${before} lost quorum or its site; the synchronous replica in ${replicaSite} was promoted, and the old primary fenced itself. `;
  } else {
    explanation = 'No database node has quorum: writes stop everywhere. No split brain, but an outage until a human intervenes. ';
  }

  const other = primary ? DCS.find((d) => d !== primary)! : null;
  const syncReplica = !!primary && !!other && up.has(other) && reachable(dataGroups, primary, other);
  const serving = primary ? DCS.filter((d) => up.has(d) && reachable(dataGroups, d, primary!)) : [];

  // Every member sees a majority, but the datacenters can't reach each other: nothing fails
  // over, yet replication and cross-site traffic are broken. That is the out-of-band witness trap.
  const dcsUp = DCS.filter((d) => up.has(d));
  const splitButQuorate = dcsUp.length === 2 && dcsUp.every((d) => quorum.includes(d)) && !reachable(dataGroups, 'dc1', 'dc2');

  let verdict: Verdict;
  if (!primary) verdict = 'outage';
  else if (splitButQuorate) {
    verdict = 'danger';
    explanation += 'Both datacenters still see the witness but not each other. Every quorum member reports healthy, so nothing fails over. ' +
      `Meanwhile the primary has lost its synchronous replica and keeps writing alone (RPO is no longer zero), and ${DCS.filter((d) => !serving.includes(d)).join(', ')} ` +
      'can no longer reach the primary, so its applications fail readiness and it is withdrawn. A second failure now loses data.';
  } else if (!syncReplica || serving.length < 2) {
    verdict = 'degraded';
    const stranded = dcsUp.filter((d) => !serving.includes(d));
    explanation += `${serving.join(' and ')} serve${serving.length === 1 ? 's' : ''} production${serving.length === 1 ? ' alone, at the planning peak if needed (RES-03), with test and acceptance suspended' : ''}. ` +
      (stranded.length ? `${stranded.join(', ')} is still up but can't reach the primary, so its applications fail readiness and global load balancing withdraws it (RES-02, RES-06). ` : '') +
      (syncReplica ? '' : 'The primary runs without a synchronous replica (non-strict mode): a class A incident until it is rebuilt (RES-05).');
  } else {
    verdict = 'ok';
    const viaHq = !data.some((e) => e.includes('dc1') && e.includes('dc2'));
    explanation += viaHq
      ? 'DC1 and DC2 still reach each other through HQ: replication and cross-site traffic continue over the 10 Gb/s links. Nothing fails over.'
      : !up.has('hq')
        ? 'Quorum continues with two of the three voting sites, and nothing fails over. There is no tolerance for a second failure until HQ is back.'
        : 'Everything that needs to reach everything else still can.';
  }
  return { scenario: s.name, quorum, primary, syncReplica, serving, verdict, explanation: explanation.trim() };
}

export const SCENARIOS: Scenario[] = [
  { name: 'Normal operation' },
  { name: 'Direct DC1–DC2 fiber cut', linksDown: [['dc1', 'dc2']] },
  { name: 'Direct DC1–DC2 fiber cut, with an out-of-band witness', linksDown: [['dc1', 'dc2']], outOfBandWitness: true },
  { name: 'HQ lost', sitesDown: ['hq'] },
  { name: 'DC1 lost (the primary site)', sitesDown: ['dc1'] },
  { name: 'DC2 lost (the replica site)', sitesDown: ['dc2'] },
  { name: 'DC1 isolated (both its WAN links cut)', linksDown: [['dc1', 'dc2'], ['dc1', 'hq']] },
  { name: 'HQ lost, then the fiber is cut (two failures)', sitesDown: ['hq'], linksDown: [['dc1', 'dc2']] },
];

export function renderMarkdown(outcomes: Outcome[]): string {
  return [
    '<!-- Generated by infrastructure/tools/simulate.ts. Do not edit. -->',
    '# Failure simulation',
    '',
    'What the design does in each failure scenario, computed from [landscape.yaml](../../enterprise-architecture/landscape/landscape.yaml). The database primary starts in DC1.',
    '',
    '| Scenario | Verdict | Quorum | Primary | Sync replica | Serving | What happens |',
    '|---|---|---|---|---|---|---|',
    ...outcomes.map((o) => `| ${o.scenario} | **${o.verdict}** | ${o.quorum.join(', ') || 'none'} | ${o.primary ?? 'none'} | ${o.syncReplica ? 'yes' : 'no'} | ${o.serving.join(', ') || 'none'} | ${o.explanation} |`),
    '',
  ].join('\n');
}

if (import.meta.main) {
  const outcomes = SCENARIOS.map((s) => simulate(loadLandscape(), s));
  if (process.argv.includes('--markdown')) console.log(renderMarkdown(outcomes));
  else for (const o of outcomes) console.log(`${o.verdict.toUpperCase().padEnd(8)} ${o.scenario}\n         ${o.explanation}\n`);
}

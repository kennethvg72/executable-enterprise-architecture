// Compares observed traffic (flow logs) with declared intent.
//
// Observed traffic is evidence, not permission. A flow that happens but isn't declared
// isn't automatically legitimate: it becomes a question for the owners of both ends. If
// they confirm it's needed, it gets declared (on both sides) and the policy allows it.
// If not, the policy will block it, and now everyone knows in advance.
//
// Usage: node network/tools/analyze-flows.ts <flowlog.csv>
//   CSV columns: source,destination,port,connections

import { readFileSync } from 'node:fs';
import { loadModel } from '../../enterprise-architecture/tools/lib/load.ts';
import type { Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { within } from '../../enterprise-architecture/tools/lib/net.ts';
import { compilePolicy, isAllowed, type Policy } from './policy.ts';

export interface Observed { source: string; destination: string; port: number; connections: number }

export interface Finding extends Observed {
  verdict: 'declared' | 'undeclared' | 'forbidden' | 'unknown-address';
  from: string;
  to: string;
  note: string;
}

export function parseFlowLog(csv: string): Observed[] {
  return csv.trim().split('\n').slice(1).filter((l) => l.trim() && !l.startsWith('#')).map((line) => {
    const [source, destination, port, connections] = line.split(',').map((x) => x.trim());
    return { source: source!, destination: destination!, port: Number(port), connections: Number(connections) };
  });
}

/** Name the owner of an address: a service, a zone, or nothing we know. */
export function identify(model: Model, address: string): string | undefined {
  for (const s of model.services.values()) {
    const all = [...s.instances, ...(s.vips ?? []), ...(s.egress ?? [])];
    if (all.some((i) => i.address === address)) return s.id;
  }
  for (const [id, z] of Object.entries(model.landscape.zones)) {
    if (id !== 'internet' && z.cidrs.some((c) => within(address, c))) return `zone:${id}`;
  }
  const internal = Object.values(model.landscape.sites).some((s) => within(address, s.prefix)) || within(address, '10.0.0.0/8');
  return internal ? undefined : 'zone:internet';
}

/**
 * Some undeclared flows aren't a question at all: the architecture forbids them, however
 * useful they are to someone. They get a rule and a compliant path forward instead.
 */
export function forbidden(model: Model, from: string, toService: string | undefined, target: string | undefined, port: number): string | undefined {
  const svc = (id: string | undefined) => (id ? model.services.get(id) : undefined);
  if (port === 22 && from !== 'zone:paw') return 'IAM-06: administration only from privileged access workstations. Path forward: request just-in-time access from a PAW.';
  if (from === 'zone:test-acceptance') return 'SEC-07: test and acceptance never reach production. Path forward: use the test or acceptance instance of the service.';
  if (svc(toService)?.kind === 'database-cluster') return 'RES-05: database nodes are reached only through the database endpoint. Path forward: connect through the endpoint on platform-lb, as the owning application.';
  if (svc(target)?.kind === 'database-cluster') {
    return "INT-01: only the owning application uses its database. Path forward: get the data through the owning application's API, or ask its owner for a read-only API for this need.";
  }
  if (from === 'zone:workforce' && svc(toService)?.kind !== 'load-balancer') return 'SEC-02: staff devices reach applications only through the load balancer. Path forward: publish the application via platform-lb.';
  return undefined;
}

/** For a load balancer address, name the service published on that frontend port. */
function behind(model: Model, lb: string, port: number): string | undefined {
  for (const s of model.services.values()) {
    const p = s.provides?.find((x) => x.via === lb && (x['frontend-port'] ?? x.port) === port);
    if (p && s.kind !== 'application') return s.id;
  }
  return undefined;
}

export function analyze(model: Model, policy: Policy, observed: Observed[]): Finding[] {
  return observed.map((o) => {
    const from = identify(model, o.source);
    const lb = identify(model, o.destination);
    const target = lb && model.services.get(lb)?.kind === 'load-balancer' ? behind(model, lb, o.port) : undefined;
    const to = target ? `${lb} → ${target}` : lb;
    if (!from || !to) {
      const unknown = !from ? o.source : o.destination;
      return { ...o, verdict: 'unknown-address', from: from ?? '?', to: to ?? '?', note: `${unknown} isn't in the landscape. Find out what it is: an inventory gap is a security gap.` };
    }
    const flow = isAllowed(policy, o.source, o.destination, o.port);
    if (flow) return { ...o, verdict: 'declared', from, to, note: flow.purpose };
    const rule = forbidden(model, from, lb, target, o.port);
    if (rule) return { ...o, verdict: 'forbidden', from, to, note: rule };
    const owner = (id: string) => (id.startsWith('zone:') ? `whoever uses ${id}` : `${id} (${model.services.get(id)?.owner ?? '?'})`);
    return {
      ...o, verdict: 'undeclared', from, to,
      note: `Ask ${owner(from)} and ${owner(target ?? to)}: is this needed? If yes, declare it on both sides. If not, it will be blocked.`,
    };
  });
}

export function renderReport(findings: Finding[]): string {
  const section = (title: string, rows: Finding[]) => [
    `## ${title} (${rows.length})`, '',
    ...(rows.length ? ['| From | To | Port | Connections | Note |', '|---|---|---|---|---|',
      ...rows.map((f) => `| ${f.from} ${f.source} | ${f.to} ${f.destination} | ${f.port} | ${f.connections} | ${f.note} |`)] : ['None.']),
    '',
  ];
  return [
    '# Observed traffic compared with declared intent', '',
    'Observed traffic is evidence, not permission. Undeclared flows are questions for the owners of both ends, not automatic additions to the policy. Some are not questions at all: the architecture forbids them.', '',
    ...section('Forbidden: will be blocked, with a path forward', findings.filter((f) => f.verdict === 'forbidden')),
    ...section('Undeclared: needs a decision', findings.filter((f) => f.verdict === 'undeclared')),
    ...section('Unknown addresses: investigate', findings.filter((f) => f.verdict === 'unknown-address')),
    ...section('Declared', findings.filter((f) => f.verdict === 'declared')),
  ].join('\n');
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node analyze-flows.ts <flowlog.csv>');
    process.exit(2);
  }
  const model = loadModel();
  console.log(renderReport(analyze(model, compilePolicy(model), parseFlowLog(readFileSync(file, 'utf8')))));
}

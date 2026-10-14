// Verifies the compiled network policy: invariants that must hold for every landscape,
// explicit expectations written by the Test Agent, and that the generated files are current.
// Usage: node network/tools/verify.ts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, appArgs, loadModel, readYaml, withApplications } from '../../enterprise-architecture/tools/lib/load.ts';
import type { Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { siteOf, within } from '../../enterprise-architecture/tools/lib/net.ts';
import { fail, pass, report, warn, type Result } from '../../enterprise-architecture/tools/lib/report.ts';
import { GENERATED, renderAll } from './compile.ts';
import { compilePolicy, isAllowed, type Policy } from './policy.ts';
import { transitFlows } from './render.ts';

export interface Expectation {
  name: string;
  from: string;
  to: string;
  port: number;
  expect: 'allow' | 'deny';
  rule: string;
}

/** Resolve "service", "service@site", "zone:x" or an address into addresses. */
export function resolveRef(model: Model, ref: string, role: 'from' | 'to'): string[] {
  if (ref.startsWith('zone:')) return model.landscape.zones[ref.slice(5)]?.cidrs.map((c) => (c === '0.0.0.0/0' ? '198.51.100.10' : c.split('/')[0]!)) ?? [];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ref)) return [ref];
  const [id, site] = ref.split('@');
  const s = model.services.get(id!);
  if (!s) throw new Error(`Unknown service in expectation: ${ref}`);
  const list = role === 'from' ? (s.egress ?? s.instances) : (s.vips ?? s.instances);
  return list.filter((i) => !site || i.site === site).map((i) => i.address);
}

export function checkExpectations(model: Model, policy: Policy, expectations: Expectation[]): Result[] {
  return expectations.map((e) => {
    const froms = resolveRef(model, e.from, 'from');
    const tos = resolveRef(model, e.to, 'to');
    const pairs = froms.flatMap((f) => tos.map((t) => ({ f, t, flow: isAllowed(policy, f, t, e.port) })));
    if (!pairs.length) return fail(e.rule, `${e.name}: nothing to test (unknown addresses).`);
    if (e.expect === 'allow') {
      const missing = pairs.filter((p) => !p.flow);
      return missing.length
        ? fail(e.rule, `${e.name}: blocked from ${missing.map((p) => `${p.f}->${p.t}`).join(', ')}:${e.port}.`, 'Declare the dependency on both sides (consumes and provides.consumers).')
        : pass(e.rule, e.name);
    }
    const leaks = pairs.filter((p) => p.flow);
    return leaks.length
      ? fail(e.rule, `${e.name}: allowed ${leaks[0]!.f}->${leaks[0]!.t}:${e.port} by "${leaks[0]!.flow!.purpose}" (${leaks[0]!.flow!.declaredIn}).`, 'Remove the declaration that allows it, or correct the expectation if intent has changed.')
      : pass(e.rule, e.name);
  });
}

/** Rules that must hold for any landscape, not just today's. */
export function checkInvariants(model: Model, policy: Policy): Result[] {
  const results: Result[] = [];
  const flows = policy.flows;
  const svc = (id: string) => model.services.get(id);

  for (const p of policy.problems) {
    results.push(p.severity === 'error' ? fail(p.rule, p.message, p.fix) : warn(p.rule, p.message, p.fix));
  }

  const check = (rule: string, ok: boolean, okText: string, failText: string, fix: string) =>
    results.push(ok ? pass(rule, okText) : fail(rule, failText, fix));

  const fromInternet = flows.filter((f) => f.from.kind === 'zone' && f.from.id === 'internet');
  const internetTargets = new Set(fromInternet.map((f) => f.to.id));
  check('SEC-02', [...internetTargets].every((t) => t === 'edge-adc'),
    'The internet reaches only the edge load balancers.',
    `The internet reaches ${[...internetTargets].filter((t) => t !== 'edge-adc').join(', ')} directly.`,
    'Publish internet-facing services via edge-adc.');

  const ssh = flows.filter((f) => f.port === 22);
  check('IAM-06', ssh.every((f) => f.from.kind === 'zone' && f.from.id === 'paw'),
    'Administrative access (port 22) comes only from privileged access workstations.',
    `Port 22 is reachable from ${ssh.filter((f) => !(f.from.kind === 'zone' && f.from.id === 'paw')).map((f) => f.from.id).join(', ')}.`,
    'Remove the flow. Administration is direct from PAWs only; there are no jump hosts.');

  const dbNodes = [...model.services.values()].filter((s) => s.kind === 'database-cluster');
  for (const db of dbNodes) {
    const nodeAddrs = db.instances.map((i) => i.address);
    const ports = new Set((db.provides ?? []).map((p) => p.port));
    const direct = flows.filter((f) => ports.has(f.port) && f.to.addresses.some((a) => nodeAddrs.includes(a)))
      .filter((f) => !(f.from.kind === 'service' && (f.from.id === db.id || svc(f.from.id)?.kind === 'load-balancer')));
    check('RES-05', direct.length === 0,
      `${db.id} nodes accept connections only from the load balancer and their own peers.`,
      `${direct.map((f) => f.from.id).join(', ')} can reach ${db.id} nodes directly.`,
      'Connect through the database service endpoint on platform-lb.');
  }

  const testFlows = flows.filter((f) => f.from.id === 'test-acceptance' || f.to.id === 'test-acceptance');
  check('SEC-07', testFlows.length === 0,
    'Test and acceptance environments have no paths to or from production.',
    `${testFlows.length} flows involve test-acceptance.`, 'Remove them.');

  const toInternet = flows.filter((f) => f.to.kind === 'zone' && f.to.id === 'internet');
  check('INT-05', toInternet.every((f) => f.from.id === 'egress-proxy'),
    'Only the egress proxy reaches the internet.',
    `${toInternet.filter((f) => f.from.id !== 'egress-proxy').map((f) => f.from.id).join(', ')} reach the internet directly.`,
    'Declare the external in consumes; traffic goes through the egress proxy.');

  const fromWorkforce = flows.filter((f) => f.from.kind === 'zone' && f.from.id === 'workforce');
  check('SEC-02', fromWorkforce.every((f) => svc(f.to.id)?.kind === 'load-balancer'),
    'Staff devices reach applications only through load balancers.',
    `Staff devices reach ${fromWorkforce.filter((f) => svc(f.to.id)?.kind !== 'load-balancer').map((f) => f.to.id).join(', ')} directly.`,
    'Publish the application via platform-lb.');

  // RES-04: every declared DC1 <-> DC2 flow must be able to transit HQ when the direct link is
  // down. Replication and quorum matter most, but applications reaching a database primary
  // in the other datacenter matter too.
  const hq = model.landscape.sites['hq'];
  const crossDc = flows.filter((f) => {
    if (f.from.kind !== 'service' || f.to.kind !== 'service') return false;
    const fromSites = new Set(f.from.addresses.map((a) => siteOf(a, model.landscape.sites)));
    const toSites = new Set(f.to.addresses.map((a) => siteOf(a, model.landscape.sites)));
    return (fromSites.has('dc1') && toSites.has('dc2')) || (fromSites.has('dc2') && toSites.has('dc1'));
  });
  const transit = hq?.transit ? transitFlows(model, policy) : [];
  const untransited = crossDc.filter((f) => !transit.some((t) => t.port === f.port && t.purpose === f.purpose));
  const quorum = crossDc.filter((f) => svc(f.from.id)?.voting || svc(f.from.id)?.kind === 'database-cluster');
  check('RES-04', crossDc.length > 0 && untransited.length === 0,
    `All ${crossDc.length} DC1 <-> DC2 flows can transit HQ, including ${quorum.length} replication and quorum flows.`,
    hq?.transit ? `${untransited.map((f) => `${f.from.id}->${f.to.id}:${f.port}`).join(', ')} can't transit HQ.` : 'HQ does not route DC1 <-> DC2 transit traffic.',
    'Allow every declared DC1 <-> DC2 flow to transit HQ. Without it, losing the direct link leaves both datacenters seeing the witness but not each other.');

  return results;
}

/** DEL-04: the generated files in the repository match what the intent produces today. */
export function checkDrift(model: Model, policy: Policy, dir = GENERATED): Result[] {
  const stale: string[] = [];
  for (const [path, content] of renderAll(model, policy)) {
    if (path === 'probes.json') continue; // not committed
    const file = join(dir, path);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== content) stale.push(path);
  }
  return [stale.length
    ? fail('DEL-04', `Generated configuration is out of date: ${stale.join(', ')}.`, 'Run npm run generate and commit the result.')
    : pass('DEL-04', 'Generated configuration matches the declared intent.')];
}

export function verifyNetwork(model = loadModel(), { drift = true } = {}): Result[] {
  const policy = compilePolicy(model);
  const expectations = readYaml<Expectation[]>(join(REPO_ROOT, 'network', 'expectations.yaml'));
  return [...checkInvariants(model, policy), ...checkExpectations(model, policy, expectations), ...(drift ? checkDrift(model, policy) : [])];
}

if (import.meta.main) {
  // --app <dir>: include an application Central IT hasn't placed yet (provisional addresses).
  const apps = appArgs();
  report('Network policy', verifyNetwork(withApplications(loadModel(), apps), { drift: apps.length === 0 }));
}

export { within };

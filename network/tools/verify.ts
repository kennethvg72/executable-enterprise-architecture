// Verifies the compiled network policy: invariants that must hold for every landscape,
// explicit expectations written by the Test Agent, and that the generated files are current.
// Then verifies the generated rules themselves (DEL-06): read back as text, without the policy
// they came from, they must do what the intent says.
// Usage: node network/tools/verify.ts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { REPO_ROOT, appArgs, loadModel, readYaml, withApplications } from '../../enterprise-architecture/tools/lib/load.ts';
import type { Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { siteOf, within } from '../../enterprise-architecture/tools/lib/net.ts';
import { fail, pass, report, warn, type Result } from '../../enterprise-architecture/tools/lib/report.ts';
import { GENERATED, renderAll } from './compile.ts';
import { compilePolicy, isAllowed, type Policy } from './policy.ts';
import { chainAccepts, parseRuleset, rulesAllow, type HostRules, type NftChain } from './nft.ts';
import { probePlan, transitFlows } from './render.ts';

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

/** Every (source, destination) address pair of a flow that crosses between DC1 and DC2. */
function crossPairs(f: Policy['flows'][number], model: Model): [string, string][] {
  const site = (a: string) => siteOf(a, model.landscape.sites);
  return f.from.addresses.flatMap((src) => f.to.addresses
    .filter((dst) => (site(src) === 'dc1' && site(dst) === 'dc2') || (site(src) === 'dc2' && site(dst) === 'dc1'))
    .map((dst): [string, string] => [src, dst]));
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
  // Matched by addresses and port: two flows with the same port and purpose (app-db and core-db
  // replication) must each be covered, not one standing in for the other.
  const untransited = crossDc.filter((f) => crossPairs(f, model).some(([src, dst]) =>
    !transit.some((t) => t.port === f.port && t.from.includes(src) && t.to.includes(dst))));
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

/**
 * DEL-06: the generated host rulesets, read back as text, do what the intent says. Every probe in
 * the probe plan and every expectation is evaluated against the rules themselves, not the policy.
 */
export function checkGeneratedRules(model: Model, policy: Policy, files: Map<string, string>, expectations: Expectation[]): Result[] {
  const results: Result[] = [];
  const hosts: HostRules = new Map();
  const paw = model.landscape.zones['paw']?.cidrs ?? [];
  for (const s of model.services.values()) {
    const text = files.get(`nftables/${s.id}.nft`);
    if (text === undefined) continue;
    let chains;
    try { chains = parseRuleset(text); } catch (e) {
      results.push(fail('DEL-06', `nftables/${s.id}.nft can't be read back: ${(e as Error).message}`, 'Fix the renderer: a ruleset nobody can verify is never assumed correct.'));
      continue;
    }
    for (const hook of ['input', 'output']) {
      const chain = chains.get(hook);
      if (!chain || chain.policy !== 'drop') results.push(fail('ZTN-03', `nftables/${s.id}.nft: the ${hook} chain is ${chain ? 'not default deny' : 'missing'}.`, 'Every host denies by default, inbound and outbound.'));
    }
    const ssh = (chains.get('input')?.rules ?? []).filter((r) => r.verdict === 'accept' && r.protocol !== 'other' && (!r.ports || r.ports.includes(22)));
    const loose = ssh.filter((r) => !r.saddr || r.saddr.negate || !r.saddr.cidrs.every((c) => paw.some((z) => within(c.split('/')[0]!, z))));
    if (loose.length) results.push(fail('IAM-06', `nftables/${s.id}.nft accepts port 22 from more than PAWs: ${loose[0]!.line}`, 'Only privileged access workstations reach port 22.'));
    // Probes only test TCP. The rules can show the rest: nothing is accepted except declared TCP,
    // ICMP for diagnostics, and VRRP between load balancer pairs (ZTN-03).
    for (const [hook, chain] of chains) {
      const other = chain.rules.filter((r) => r.verdict === 'accept' && (r.protocol === 'any' || (r.protocol === 'other' && !['icmp', 'vrrp'].includes(r.protocolName ?? ''))));
      if (other.length) results.push(fail('ZTN-03', `nftables/${s.id}.nft (${hook}) accepts more than TCP, ICMP and VRRP: ${other[0]!.line}`, 'Fix the renderer: every accepted flow is a declared TCP flow.'));
    }
    for (const i of [...s.instances, ...(s.vips ?? []), ...(s.egress ?? [])]) hosts.set(i.address, chains);
  }
  // RES-04 on the output: when the direct fiber is down, the HQ router itself must forward every
  // declared DC1 <-> DC2 address pair, checked on its generated rules, not on the renderer's list.
  const hqText = files.get('nftables/hq-router.nft');
  if (model.landscape.sites['hq']?.transit) {
    let forward: NftChain | undefined;
    try { forward = hqText === undefined ? undefined : parseRuleset(hqText).get('forward'); } catch (e) {
      results.push(fail('DEL-06', `nftables/hq-router.nft can't be read back: ${(e as Error).message}`, 'Fix the renderer.'));
    }
    const crossing = policy.flows.filter((f) => f.from.kind === 'service' && f.to.kind === 'service').flatMap((f) => crossPairs(f, model).map(([src, dst]) => ({ f, src, dst })));
    const missing = crossing.filter(({ f, src, dst }) => !forward || !chainAccepts(forward, src, dst, f.port));
    results.push(missing.length
      ? fail('RES-04', `The HQ router's generated rules don't forward ${missing.length} of ${crossing.length} DC1 <-> DC2 paths, for example ${missing.slice(0, 3).map(({ f, src, dst }) => `${f.from.id} ${src} -> ${f.to.id} ${dst}:${f.port}`).join('; ')}.`, 'Fix the renderer, then regenerate. Without transit, losing the direct fiber splits the datacenters.')
      : pass('RES-04', `The HQ router's generated rules forward all ${crossing.length} declared DC1 <-> DC2 paths.`));
  }

  // A path between two hosts without generated rules (zones, the edge appliances) is enforced
  // elsewhere; the host rules can't decide it, so it isn't counted either way.
  const probes = probePlan(model, policy).filter((pr) => hosts.has(pr.from) || hosts.has(pr.to));
  const wrong = probes.filter((pr) => rulesAllow(hosts, pr.from, pr.to, pr.port) !== (pr.expect === 'open'));
  results.push(wrong.length
    ? fail('DEL-06', `The generated rules disagree with the intent on ${wrong.length} of ${probes.length} paths, for example ${wrong.slice(0, 3).map((w) => `${w.fromLabel} -> ${w.toLabel} ${w.to}:${w.port} (intent: ${w.expect})`).join('; ')}.`, 'Fix the renderer, then regenerate.')
    : pass('DEL-06', `The generated rules, read back, agree with the intent on all ${probes.length} paths in the probe plan that host rules decide.`));
  const broken = expectations.filter((e) => {
    const pairs = resolveRef(model, e.from, 'from').flatMap((f) => resolveRef(model, e.to, 'to').map((t) => rulesAllow(hosts, f, t, e.port)));
    return pairs.length === 0 || (e.expect === 'allow' ? pairs.some((ok) => !ok) : pairs.some((ok) => ok));
  });
  results.push(broken.length
    ? fail('DEL-06', `On the generated rules, ${broken.length} expectations don't hold: ${broken.slice(0, 3).map((e) => e.name).join('; ')}.`, 'Fix the renderer, then regenerate.')
    : pass('DEL-06', `All ${expectations.length} expectations hold on the generated rules too.`));
  return results;
}

/**
 * DEL-06 for the egress proxy: its generated allowlist, parsed as the proxy would parse it, lets
 * each service reach exactly its declared externals, from its own addresses, and nothing else.
 */
export function checkEgressAllowlist(model: Model, files: Map<string, string>): Result[] {
  const text = files.get('egress-proxy/allowlist.yaml');
  if (text === undefined) return [fail('INT-05', 'egress-proxy/allowlist.yaml is missing.', 'Generate it.')];
  let doc: { allow?: { service: string; sources?: string[]; destinations?: string[] }[]; default?: string };
  try { doc = parseYaml(text) as typeof doc; } catch (e) {
    return [fail('DEL-06', `egress-proxy/allowlist.yaml isn't valid YAML: ${(e as Error).message.split('\n')[0]}`, 'Fix the renderer: the proxy would reject the file, or read something else.')];
  }
  const found: string[] = [];
  if (doc.default !== 'deny') found.push('the default isn\'t deny');
  const externals = model.landscape.externals ?? {};
  const expected = new Map<string, Set<string>>();
  for (const svc of model.services.values()) {
    for (const c of svc.consumes ?? []) {
      const ext = c.external ? externals[c.external] : undefined;
      if (!ext || (ext.consumers !== 'any' && !ext.consumers.includes(svc.id))) continue;
      const set = expected.get(svc.id) ?? new Set<string>();
      set.add(`${ext.fqdn}:${ext.port}`);
      expected.set(svc.id, set);
    }
  }
  for (const entry of doc.allow ?? []) {
    const svc = model.services.get(entry.service);
    const want = expected.get(entry.service) ?? new Set<string>();
    for (const d of entry.destinations ?? []) {
      if (!want.has(d)) found.push(`${entry.service} may reach ${d}, which it doesn't declare`);
      const ext = Object.values(externals).find((x) => `${x.fqdn}:${x.port}` === d);
      if (d.includes('*') && !ext?.['wildcard-reason']) found.push(`${entry.service} may reach the wildcard ${d} without a recorded reason: anything under it is an exfiltration channel`);
    }
    const own = (svc?.egress ?? svc?.instances ?? []).map((i) => i.address);
    if ((entry.sources ?? []).some((a) => !own.includes(a))) found.push(`${entry.service}'s entry accepts addresses that aren't its own`);
  }
  for (const [service, want] of expected) {
    const entry = doc.allow?.find((e) => e.service === service);
    for (const d of want) if (!entry?.destinations?.includes(d)) found.push(`${service} can't reach its declared ${d}`);
  }
  return [found.length
    ? fail('INT-05', `egress-proxy/allowlist.yaml: ${found.join('; ')}.`, 'Fix the renderer or the declarations, then regenerate.')
    : pass('INT-05', 'The egress allowlist, as the proxy reads it, allows each service exactly its declared externals.')];
}

/** The generated files as deployed (from the repository), or as this model would produce them. */
function generatedFiles(model: Model, policy: Policy, fromDisk: boolean): Map<string, string> {
  const rendered = renderAll(model, policy);
  if (!fromDisk) return rendered;
  return new Map([...rendered.keys()].filter((path) => existsSync(join(GENERATED, path))).map((path) => [path, readFileSync(join(GENERATED, path), 'utf8')]));
}

export function verifyNetwork(model = loadModel(), { drift = true } = {}): Result[] {
  const policy = compilePolicy(model);
  const expectations = readYaml<Expectation[]>(join(REPO_ROOT, 'network', 'expectations.yaml'));
  return [
    ...checkInvariants(model, policy),
    ...checkExpectations(model, policy, expectations),
    ...checkGeneratedRules(model, policy, generatedFiles(model, policy, drift), expectations),
    ...checkEgressAllowlist(model, generatedFiles(model, policy, drift)),
    ...(drift ? checkDrift(model, policy) : []),
  ];
}

if (import.meta.main) {
  // --app <dir>: include an application Central IT hasn't placed yet (provisional addresses).
  const apps = appArgs();
  report('Network policy', verifyNetwork(withApplications(loadModel(), apps), { drift: apps.length === 0 }));
}

export { within };

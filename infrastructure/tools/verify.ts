// Verifies infrastructure intent and the generated configuration: health checks, database
// endpoints and replication settings, placement, capacity, and the quorum topology.
// Usage: node infrastructure/tools/verify.ts

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { appArgs, loadModel, withApplications } from '../../enterprise-architecture/tools/lib/load.ts';
import type { Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { fail, pass, report, warn, type Result } from '../../enterprise-architecture/tools/lib/report.ts';
import { GENERATED, renderAll, renderEdgeSpec, renderHaproxy } from './render.ts';
import { checkGeneratedConfig } from './check-output.ts';
import { simulate } from './simulate.ts';
import { connected, topology } from './topology.ts';

const DCS = ['dc1', 'dc2'];

/** RES-06 and RES-05, on the rendered HAProxy configuration itself. */
export function checkLoadBalancers(model: Model): Result[] {
  const results: Result[] = [];
  for (const site of DCS) {
    const cfg = renderHaproxy(model, site);
    const blocks = cfg.split(/\n(?=backend |listen )/).slice(1);
    for (const block of blocks) {
      const name = block.split('\n')[0]!.split(' ')[1]!;
      if (name === 'unknown-application') continue;
      const servers = block.split('\n').filter((l) => l.trim().startsWith('server '));
      const http = /option httpchk/.test(block) && /http-check expect status 200/.test(block);
      const path = block.match(/http-check send meth GET uri (\S+)/)?.[1] ?? '';
      if (!servers.length) {
        results.push(fail('RES-06', `${site}: backend ${name} has no servers.`));
      } else if (!http || !servers.every((s) => / check( |$)/.test(s))) {
        results.push(fail('RES-06', `${site}: backend ${name} doesn't check readiness over HTTP.`, 'Declare health { port, path: /health/ready } on the interface.'));
      } else if (block.includes('mode tcp')) {
        const ok = path === '/primary' && /on-marked-down shutdown-sessions/.test(block);
        results.push(ok
          ? pass('RES-05', `${site}: ${name} routes only to the current primary, and cuts connections to a demoted one.`)
          : fail('RES-05', `${site}: ${name} doesn't route by primary role.`, 'Check Patroni\'s /primary endpoint, with on-marked-down shutdown-sessions.'));
      } else {
        results.push(/ready/.test(path)
          ? pass('RES-06', `${site}: ${name} routes on readiness (${path}).`)
          : fail('RES-06', `${site}: ${name} checks ${path || '(nothing)'}, which isn't a readiness endpoint.`, 'Check /health/ready.'));
      }
    }
  }
  // RES-02: every class A and B application published to staff has a global load balancing record,
  // so a datacenter whose instances aren't ready is withdrawn.
  const edge = renderEdgeSpec(model);
  for (const s of model.services.values()) {
    for (const p of s.provides ?? []) {
      if (p.via !== 'platform-lb' || s.kind === 'database-cluster' || s.class === 'C') continue;
      results.push(edge.includes(`- name: ${s.id}.natax.internal`)
        ? pass('RES-02', `${s.id}: global load balancing withdraws a datacenter whose instances aren't ready.`)
        : fail('RES-02', `${s.id} has no global load balancing record.`, 'Render internal-global records for every interface published via platform-lb.'));
    }
  }
  // The edge appliances: every published service has a readiness monitor.
  for (const s of model.services.values()) {
    for (const p of s.provides ?? []) {
      if (p.via === 'edge-adc' && !p.health?.path.includes('ready')) {
        results.push(fail('RES-06', `${s.id} is published at the edge without a readiness check.`, 'Declare health { path: /health/ready }.'));
      }
    }
  }
  return results;
}

export function checkDatabases(model: Model): Result[] {
  const results: Result[] = [];
  for (const db of [...model.services.values()].filter((s) => s.kind === 'database-cluster')) {
    const r = db.replication;
    const sites = new Set(db.instances.map((i) => i.site));
    const problems = [
      !r && 'no replication settings',
      r && !r.synchronous && 'replication is not synchronous',
      r && r.strict && 'strict synchronous mode would stop all writes when the replica is lost',
      r && r.watchdog !== 'required' && 'the watchdog is not required, so a primary that loses its lock may not be fenced',
      r && r.promote !== 'synchronous-replica-only' && 'replicas other than the synchronous one could be promoted',
      !(sites.has('dc1') && sites.has('dc2')) && 'it does not have a node in both datacenters',
    ].filter(Boolean);
    results.push(problems.length
      ? fail('RES-05', `${db.id}: ${problems.join('; ')}.`, 'Set replication { synchronous: true, strict: false, promote: synchronous-replica-only, watchdog: required } with one node per datacenter.')
      : pass('RES-05', `${db.id}: synchronous, non-strict, watchdog fencing, only the synchronous replica promotable, a node in each datacenter.`));
  }
  return results;
}

export function checkPlacement(model: Model): Result[] {
  const results: Result[] = [];
  for (const s of model.services.values()) {
    if (s.class === 'C' || s.appliance) continue;
    const sites = new Set(s.instances.map((i) => i.site));
    const missing = DCS.filter((d) => !sites.has(d));
    if (missing.length) results.push(fail('RES-02', `${s.id} (class ${s.class}) has no instances in ${missing.join(', ')}.`, 'Run class A and B services in both datacenters.'));
  }
  for (const [id, { manifest }] of model.manifests) {
    const s = model.services.get(id)!;
    const rt = manifest.runtime;
    for (const site of rt.sites) {
      const count = s.instances.filter((i) => i.site === site).length;
      if (count !== rt['instances-per-site']) {
        results.push(fail('RES-02', `${id}: ${count} instance(s) placed in ${site}, but the manifest asks for ${rt['instances-per-site']}.`, 'Central IT updates placements in landscape.yaml to match.'));
      }
    }
    const perSite = rt['instances-per-site'] * rt.capacity['instance-requests-per-second'];
    const peak = rt.capacity['peak-requests-per-second'];
    results.push(perSite >= peak
      ? pass('RES-03', `${id}: one datacenter handles ${perSite} req/s against a planning peak of ${peak}.`)
      : fail('RES-03', `${id}: one datacenter handles only ${perSite} req/s, but the planning peak is ${peak}.`, 'Add instances per site, or make each instance faster, and measure it.'));
  }
  if (!results.some((r) => r.status === 'fail')) results.push(pass('RES-02', 'Every class A and B service runs in both datacenters, as its manifest asks.'));
  return results;
}

/** RES-03: each datacenter alone holds every class A and B reservation, plus its class C. */
export function checkCapacity(model: Model): Result[] {
  const results: Result[] = [];
  const reserved = [...model.services.values()].filter((s) => s.class !== 'C').reduce((sum, s) => sum + (s['peak-vcpu'] ?? 0), 0);
  for (const site of DCS) {
    const info = model.landscape.sites[site]!;
    const capacity = info['capacity-vcpu'] ?? 0;
    const classC = [...model.services.values()].filter((s) => s.class === 'C' && s.instances.some((i) => i.site === site)).reduce((sum, s) => sum + (s['peak-vcpu'] ?? 0), 0);
    const needed = reserved + classC;
    results.push(needed <= capacity
      ? pass('RES-03', `${site}: class A and B production reserves ${reserved} vCPU at the planning peak (+${classC} class C) of ${capacity}. It can carry everything alone.`)
      : fail('RES-03', `${site}: needs ${needed} vCPU to carry the planning peak alone, but has ${capacity}.`, 'Add capacity, or reduce what class A and B services need. Reclaiming test and acceptance is already counted.'));
    // In normal operation production uses about half of its reservation; test and acceptance use the rest.
    const idle = capacity - needed + Math.floor(reserved / 2);
    const wanted = info['test-acceptance-vcpu'] ?? 0;
    results.push(idle >= wanted
      ? pass('RES-03', `${site}: about ${idle} vCPU is idle in normal operation; test and acceptance typically use ${wanted}.`)
      : warn('RES-03', `${site}: test and acceptance typically use ${wanted} vCPU, but only about ${idle} is idle in normal operation.`, 'Expect slow test environments, or add capacity.'));
  }
  return results;
}

/** RES-04: voting members, in-band links and transit, checked structurally and by simulation. */
export function checkTopology(model: Model): Result[] {
  const results: Result[] = [];
  const l = model.landscape;
  for (const v of [...model.services.values()].filter((s) => s.voting)) {
    const perSite = new Map<string, number>();
    for (const i of v.instances) perSite.set(i.site, (perSite.get(i.site) ?? 0) + 1);
    const ok = perSite.size === 3 && [...perSite.values()].every((n) => n === 1) && perSite.has('hq');
    results.push(ok
      ? pass('RES-04', `${v.id}: one voting member in each of ${[...perSite.keys()].join(', ')}.`)
      : fail('RES-04', `${v.id}: voting members are not one per site across DC1, DC2 and HQ.`, 'Place exactly one member in each of the three sites.'));
  }
  const t = topology(l);
  const notInBand = l.links.filter((x) => x.between.includes('hq') && x.between.some((s) => DCS.includes(s)) && x.network !== 'wan');
  if (notInBand.length) {
    results.push(fail('RES-04', `The witness site is connected out of band (${notInBand.map((x) => `${x.between.join('-')}: ${x.network}`).join(', ')}).`, 'Connect HQ to both datacenters over the in-band WAN.'));
  }
  if (!l.sites['hq']?.transit) {
    results.push(fail('RES-04', 'HQ does not route traffic between DC1 and DC2.', 'Enable transit at HQ, so reachability is transitive.'));
  }
  // Any single in-band link failure must leave DC1 and DC2 connected.
  const up = new Set(t.sites);
  for (const link of t.data) {
    const remaining = t.data.filter((e) => e !== link);
    if (!connected(t, remaining, up, 'dc1', 'dc2')) {
      results.push(fail('RES-04', `Losing the ${link.join('-')} link disconnects DC1 from DC2.`, 'Every single link failure must leave the datacenters connected, through HQ if necessary.'));
    }
  }
  const fiberCut = simulate(l, { name: 'fiber cut', linksDown: [['dc1', 'dc2']] });
  results.push(fiberCut.verdict === 'ok'
    ? pass('RES-04', 'Simulated fiber cut: DC1 and DC2 stay connected through HQ, both keep serving, the replica stays synchronous.')
    : fail('RES-04', `Simulated fiber cut: ${fiberCut.explanation}`, 'Keep the witness in-band, with transit at HQ.'));
  return results;
}

export function checkDrift(model: Model, dir = GENERATED): Result[] {
  const stale = [...renderAll(model)].filter(([path, content]) => {
    const file = join(dir, path);
    return !existsSync(file) || readFileSync(file, 'utf8') !== content;
  }).map(([path]) => path);
  return [stale.length
    ? fail('DEL-04', `Generated configuration is out of date: ${stale.join(', ')}.`, 'Run npm run generate and commit the result.')
    : pass('DEL-04', 'Generated configuration matches the declared intent.')];
}

/** The generated files as deployed (from the repository), or as this model would produce them. */
function generatedFiles(model: Model, fromDisk: boolean): Map<string, string> {
  const rendered = renderAll(model);
  if (!fromDisk) return rendered;
  return new Map([...rendered.keys()].filter((path) => existsSync(join(GENERATED, path))).map((path) => [path, readFileSync(join(GENERATED, path), 'utf8')]));
}

export function verifyInfrastructure(model = loadModel(), { drift = true } = {}): Result[] {
  return [
    ...checkLoadBalancers(model),
    ...checkDatabases(model),
    ...checkPlacement(model),
    ...checkCapacity(model),
    ...checkTopology(model),
    // DEL-06: the configuration itself, read back, not the intent it was rendered from.
    ...checkGeneratedConfig(model, generatedFiles(model, drift)),
    ...(drift ? checkDrift(model) : []),
  ];
}

if (import.meta.main) {
  // --app <dir>: include an application Central IT hasn't placed yet (provisional addresses).
  const apps = appArgs();
  report('Infrastructure', verifyInfrastructure(withApplications(loadModel(), apps), { drift: apps.length === 0 }));
}

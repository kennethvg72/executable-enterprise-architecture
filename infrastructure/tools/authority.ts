// The authority for infrastructure configuration (DEL-06): HAProxy, in the pinned version, started
// with the generated configuration against stub backends, and observed through its behavior and
// its stats socket (authority-run.ts). Patroni's dynamic settings are proven after they are
// applied, on the running cluster (check-patroni-config.ts). The fast readers (check-output.ts)
// may only fail early.
//
// Needs Linux, HAProxy, OpenSSL and root: the pipeline's runner. Elsewhere it reports that it
// didn't run, and the result is INCOMPLETE. Not observed here: the overload answer (it takes
// thousands of connections), so the reader is its only check.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { authorityBlockers, installedVersion, notProven, pinnedVersions } from '../../enterprise-architecture/tools/lib/authority.ts';
import { fail, pass, type Result } from '../../enterprise-architecture/tools/lib/report.ts';
import type { Finding, SitePlan } from './authority-run.ts';

const DOMAIN = 'natax.internal';

/** What to observe, from the intent: a published application, its consumers, and every database endpoint. */
export function authorityPlan(model: Model, configDir: string): SitePlan[] {
  const lb = model.services.get('platform-lb');
  const published = [...model.services.values()].flatMap((s) => (s.provides ?? []).filter((p) => p.via === 'platform-lb').map((p) => ({ s, p })));
  const app = published.find((x) => x.s.kind !== 'database-cluster');
  const dbs = published.filter((x) => x.s.kind === 'database-cluster');
  if (!lb?.vips || !app) return [];
  const consumer = (Array.isArray(app.p.consumers) ? app.p.consumers : [])[0] ?? '';
  const zone = consumer.startsWith('zone:') ? model.landscape.zones[consumer.slice(5)] : undefined;
  const consumerAddress = zone ? zone.cidrs[0]!.split('/')[0]!.replace(/\.0$/, '.5') : model.services.get(consumer)?.instances[0]?.address ?? '';
  return lb.vips.map((vip) => {
    const local = app.s.instances.find((i) => i.site === vip.site)!;
    const remote = app.s.instances.find((i) => i.site !== vip.site)!;
    return {
      site: vip.site, vip: vip.address, config: join(configDir, `platform-lb-${vip.site}.cfg`),
      app: {
        id: app.s.id, host: `${app.s.id}.${DOMAIN}`, port: app.p.port, healthPort: app.p.health?.port ?? app.p.port,
        local: local.address, remote: remote.address, localServer: `${local.site}-1`, remoteServer: `${remote.site}-1`,
      },
      // TEST-NET-1: an address in no zone and no service, so it consumes nothing here.
      sources: { consumer: consumerAddress, unlisted: '192.0.2.10', otherHost: `not-${app.s.id}.${DOMAIN}` },
      dbs: dbs.map((db) => ({
        id: db.s.id, frontendPort: db.p['frontend-port'] ?? db.p.port,
        nodes: db.s.instances.map((i) => ({ addr: i.address, port: db.p.port, apiPort: db.p.health?.port ?? 8008, host: `${db.s.id}-${i.site}.${DOMAIN}`, site: i.site })),
      })),
    };
  });
}

/** onlySite: observe just one datacenter's configuration, for the authority's own tests. */
export function infrastructureAuthority(model: Model, files: Map<string, string>, onlySite?: string): Result[] {
  const pinned = pinnedVersions('infrastructure');
  const installed = installedVersion('haproxy', ['-v'], /version (\d+\.\d+\.\d+)/);
  const blockers = authorityBlockers([{ name: 'haproxy', pinned: pinned['haproxy']!, installed }]);
  if (process.platform === 'linux' && process.getuid?.() !== 0) blockers.push('it needs root, to create a network namespace');
  // Unit tests switch the authority off; that can only make a result incomplete, never a pass.
  if (process.env.NATAX_AUTHORITIES === 'off') blockers.push('it is switched off (NATAX_AUTHORITIES=off)');
  if (process.platform === 'linux' && !installedVersion('openssl', ['version'], /OpenSSL (\S+)/)) blockers.push('OpenSSL isn\'t installed, for the test certificates');
  if (blockers.length) return [notProven('DEL-06', 'The load balancer configuration', blockers)];

  const dir = mkdtempSync(join(tmpdir(), 'haproxy-authority-'));
  try {
    for (const [path, text] of files) if (path.startsWith('haproxy/')) writeFileSync(join(dir, path.slice('haproxy/'.length)), text);
    const plan = authorityPlan(model, dir).filter((x) => !onlySite || x.site === onlySite);
    writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
    const run = spawnSync(process.execPath, [join(import.meta.dirname, 'authority-run.ts'), dir], { encoding: 'utf8', timeout: 15 * 60_000 });
    if (run.status !== 0) return [{ ...fail('DEL-06', `The load balancer authority didn't finish: ${(run.stderr || run.stdout).trim().slice(-600)}`, 'Fix the authority run; until then nothing is proven.'), tier: 'authority' }];
    const findings = JSON.parse(run.stdout) as Finding[];
    // For investigation: NATAX_AUTHORITY_DUMP=<file> writes every observation there.
    if (process.env.NATAX_AUTHORITY_DUMP) writeFileSync(process.env.NATAX_AUTHORITY_DUMP, JSON.stringify(findings, null, 1));
    const bad = findings.filter((f) => !f.ok);
    const where = `HAProxy ${installed}, against stub backends`;
    return [{
      ...(bad.length
        ? fail('DEL-06', `Real HAProxy doesn't behave as the intent says (${where}): ${bad.map((f) => `${f.site}: ${f.scenario} (${f.detail})`).join('; ')}.`, 'Fix the renderer, then regenerate. HAProxy\'s behavior is the authority.')
        : pass('DEL-06', `Proven in real HAProxy (${where}), for ${plan.length} datacenters: ${[...new Set(findings.map((f) => f.scenario))].join('; ')}.`)),
      tier: 'authority',
    }];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

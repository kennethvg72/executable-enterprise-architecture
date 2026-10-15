// Verifies the generated configuration itself (DEL-06): HAProxy, keepalived, Patroni and the
// edge health checks are read back as text and checked against the standards and the declared
// intent. Nothing here calls the renderer or reuses its helpers, so a renderer bug shows up as a
// difference instead of agreeing with itself.

import { parse } from 'yaml';
import type { Model, Service } from '../../enterprise-architecture/tools/lib/model.ts';
import { siteOf } from '../../enterprise-architecture/tools/lib/net.ts';
import { fail, pass, type Result } from '../../enterprise-architecture/tools/lib/report.ts';

/** HAProxy sections ("backend x", "listen y", ...) and their lines. */
export function haproxySections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { current = []; sections.set(line.trim(), current); continue; }
    current?.push(line.trim());
  }
  return sections;
}

const published = (model: Model, via: string) => [...model.services.values()].flatMap((service) =>
  (service.provides ?? []).filter((p) => p.via === via).map((provide) => ({ service, provide })));

const addressesOf = (lines: string[]) => lines.filter((l) => l.startsWith('server ')).map((l) => l.split(/\s+/)[2]!.split(':')[0]!);
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function checkGeneratedConfig(model: Model, files: Map<string, string>): Result[] {
  const results: Result[] = [];
  const problems = (rule: string, what: string, found: string[], fix: string, ok: string) =>
    results.push(found.length ? fail(rule, `${what}: ${found.join('; ')}.`, fix) : pass(rule, ok));
  const lb = model.services.get('platform-lb');

  // ---- HAProxy, per datacenter: readiness checks, verified TLS, every instance present.
  for (const vip of lb?.vips ?? []) {
    const file = `haproxy/platform-lb-${vip.site}.cfg`;
    const text = files.get(file);
    if (text === undefined) { results.push(fail('DEL-06', `${file} is missing.`, 'Generate it.')); continue; }
    const sections = haproxySections(text);
    const found: string[] = [];
    for (const { service, provide } of published(model, 'platform-lb')) {
      const isDb = service.kind === 'database-cluster';
      const name = `${isDb ? 'listen' : 'backend'} ${service.id}`;
      const lines = sections.get(name);
      if (!lines) { found.push(`no "${name}"`); continue; }
      const path = provide.health?.path;
      if (!lines.includes('option httpchk') || !lines.some((l) => l.startsWith('http-check send') && l.split(/\s+/).includes(path ?? '?'))) found.push(`${service.id} isn't health-checked on ${path}`);
      if (!lines.includes('http-check expect status 200')) found.push(`${service.id} doesn't require status 200`);
      if (!sameSet(addressesOf(lines), service.instances.map((i) => i.address))) found.push(`${service.id}'s servers aren't exactly its instances`);
      const servers = lines.filter((l) => l.startsWith('server '));
      if (servers.some((l) => !/\bcheck\b/.test(l))) found.push(`${service.id} has a server without a health check`);
      if (servers.some((l) => !/verify required/.test(l))) found.push(`${service.id} has a server without verified TLS`);
      if (isDb) {
        if (!lines.some((l) => l.includes('on-marked-down shutdown-sessions'))) found.push(`${service.id} keeps connections to a demoted primary`);
        if (!lines.some((l) => l === `bind ${vip.address}:${provide['frontend-port'] ?? provide.port}`)) found.push(`${service.id} isn't bound to ${vip.address}:${provide['frontend-port'] ?? provide.port}`);
      } else {
        if (servers.some((l) => siteOf(l.split(/\s+/)[2]!.split(':')[0]!, model.landscape.sites) !== vip.site && !/\bbackup\b/.test(l))) found.push(`${service.id} sends traffic to the other datacenter while its own is healthy`);
        if (!(sections.get('frontend apps') ?? []).some((l) => l.startsWith(`use_backend ${service.id} `))) found.push(`no route to ${service.id}`);
      }
    }
    const frontend = sections.get('frontend apps') ?? [];
    if (!frontend.some((l) => /^http-request deny\b.*\bpath_beg \/health\//.test(l))) found.push('clients can call /health/* through the load balancer');
    problems('RES-06', file, found, 'Fix the renderer, then regenerate.', `${file}: every published service is health-checked on its readiness path, over verified TLS, with all its instances; clients can't reach /health/*.`);
  }

  // ---- keepalived: each load balancer node can take over its datacenter's VIP.
  const found: string[] = [];
  for (const node of lb?.instances ?? []) {
    const text = files.get(`keepalived/platform-lb-${node.address}.conf`);
    const vip = lb?.vips?.find((v) => v.site === node.site);
    const peers = lb!.instances.filter((i) => i.site === node.site && i.address !== node.address);
    if (text === undefined) { found.push(`no configuration for ${node.address}`); continue; }
    if (!vip || !text.includes(`${vip.address}/`)) found.push(`${node.address} doesn't carry its VIP`);
    if (peers.some((p) => !new RegExp(`unicast_peer \\{[^}]*\\b${p.address.replace(/\./g, '\\.')}\\b`).test(text))) found.push(`${node.address} doesn't know its peer`);
    if (!/track_script \{[^}]*\w/.test(text)) found.push(`${node.address} doesn't move the VIP when HAProxy dies`);
  }
  problems('RES-02', 'keepalived', found, 'Fix the renderer, then regenerate.', 'Every load balancer node can take over its datacenter\'s VIP, and gives it up when HAProxy dies.');

  // ---- Patroni: synchronous, not strict, fenced by a watchdog, quorum across three sites. The
  // dynamic settings are checked in the file applied to the running cluster: bootstrap.dcs only
  // counts when a cluster is first created, and must say the same.
  const clusters = [...model.services.values()].filter((s: Service) => s.kind === 'database-cluster' && s.replication);
  for (const db of clusters) {
    const file = `patroni/${db.id}.yml`;
    const text = files.get(file);
    const dcsText = files.get(`patroni/${db.id}.dcs.yml`);
    if (text === undefined || dcsText === undefined) { results.push(fail('DEL-06', `${text === undefined ? file : `patroni/${db.id}.dcs.yml`} is missing.`, 'Generate it.')); continue; }
    type Dcs = Record<string, unknown> & { postgresql?: { parameters?: Record<string, unknown> } };
    const cfg = parse(text) as { etcd3?: { protocol?: string; hosts?: string[]; cert?: string }; bootstrap?: { dcs?: Dcs }; watchdog?: { mode?: string } };
    const dcs = (parse(dcsText) ?? {}) as Dcs;
    const found: string[] = [];
    if (dcs['synchronous_mode'] !== true) found.push('not synchronous');
    if (dcs['synchronous_mode_strict'] !== false) found.push('strict synchronous mode, which stops writes when the replica is lost');
    if (dcs['synchronous_node_count'] !== 1) found.push('not exactly one synchronous replica');
    if (String(dcs.postgresql?.parameters?.['ssl']) !== 'on') found.push('PostgreSQL without TLS');
    if (JSON.stringify(cfg.bootstrap?.dcs) !== JSON.stringify(dcs)) found.push('bootstrap.dcs differs from the settings applied to the running cluster');
    if (cfg.watchdog?.mode !== 'required') found.push(`watchdog "${cfg.watchdog?.mode}", so a primary that loses its lock may keep writing`);
    const sites = new Set((cfg.etcd3?.hosts ?? []).map((h) => siteOf(h.split(':')[0]!, model.landscape.sites)));
    if ((cfg.etcd3?.hosts ?? []).length !== 3 || sites.size !== 3 || sites.has(undefined)) found.push('the quorum isn\'t three members in three sites');
    if (cfg.etcd3?.protocol !== 'https') found.push('quorum traffic isn\'t encrypted');
    if (!cfg.etcd3?.cert?.includes(`patroni-${db.id}.`)) found.push('it doesn\'t use its own etcd identity');
    problems('RES-05', file, found, 'Fix the renderer, then regenerate.', `${file}: synchronous, not strict, watchdog fencing, quorum across three sites, its own etcd identity; the same settings for new and running clusters.`);
  }

  // ---- etcd: each cluster's identity may touch only its own keys, so one cluster sharing the
  // quorum can't take another's leader lock.
  const rbacText = files.get('etcd/rbac.yaml');
  const rbac = rbacText === undefined ? undefined : parse(rbacText) as { auth?: string; roles?: { role: string; 'readwrite-prefix'?: string; 'read-prefix'?: string }[]; users?: { user: string; roles?: string[] }[] };
  const rbacFound: string[] = [];
  if (!rbac) rbacFound.push('etcd/rbac.yaml is missing');
  else if (rbac.auth !== 'enabled') rbacFound.push('authentication is not enabled');
  for (const db of rbac ? clusters : []) {
    const user = rbac!.users?.find((u) => u.user === `patroni-${db.id}`);
    if (!user) { rbacFound.push(`no etcd user for ${db.id}`); continue; }
    const prefixes = (user.roles ?? []).flatMap((r) => rbac!.roles?.filter((x) => x.role === r) ?? []).flatMap((x) => [x['readwrite-prefix'], x['read-prefix']]).filter(Boolean);
    if (prefixes.length === 0 || prefixes.some((pre) => pre !== `/service/${db.id}/`)) rbacFound.push(`${db.id}'s identity can reach ${prefixes.join(', ') || 'nothing'}, not only /service/${db.id}/`);
  }
  problems('SEC-09', 'etcd/rbac.yaml', rbacFound, 'Fix the renderer, then regenerate.', 'Each database cluster\'s etcd identity can touch only its own keys.');

  // ---- Edge appliances: readiness monitors, and every instance in the pool.
  const edgeText = files.get('edge/health-checks.yaml');
  const edge = edgeText === undefined ? undefined : (parse(edgeText) as { services?: { name: string; pool?: { address: string }[]; monitor?: { protocol?: string; path?: string; 'expect-status'?: number }; 'client-blocked-paths'?: string[] }[] }).services ?? [];
  const edgeFound: string[] = [];
  if (!edge) edgeFound.push('edge/health-checks.yaml is missing');
  for (const { service, provide } of published(model, 'edge-adc')) {
    const entry = edge?.find((e) => e.name === `${service.id}/${provide.name}`);
    if (!entry) { if (edge) edgeFound.push(`no monitor for ${service.id}/${provide.name}`); continue; }
    if (entry.monitor?.path !== provide.health?.path || entry.monitor?.protocol !== 'https' || entry.monitor?.['expect-status'] !== 200) edgeFound.push(`${service.id}/${provide.name} isn't monitored on ${provide.health?.path} over HTTPS`);
    if (!sameSet((entry.pool ?? []).map((p) => p.address), service.instances.map((i) => i.address))) edgeFound.push(`${service.id}/${provide.name}'s pool isn't exactly its instances`);
    if (!(entry['client-blocked-paths'] ?? []).includes('/health/')) edgeFound.push(`${service.id}/${provide.name} forwards /health/* from the internet`);
  }
  problems('RES-06', 'edge/health-checks.yaml', edgeFound, 'Fix the renderer, then regenerate.', 'Every internet-facing service is monitored on its readiness path, with all its instances.');
  return results;
}

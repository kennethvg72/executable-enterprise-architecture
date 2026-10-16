// Fast readers for the generated configuration (DEL-06): HAProxy, keepalived, Patroni, pgBackRest,
// etcd access control and the edge appliances' health checks are read back as text and checked
// against the standards and the declared intent, without the renderer's help.
//
// A reader may only fail early. When it finds nothing wrong, the configuration still needs the
// authority, the real software running it (authority.ts), before it counts.
//
// Each reader's grammar is an explicit allowlist of exactly what the renderer produces. Anything
// else is refused, however valid it is to HAProxy or Patroni: "no option httpchk", "verify none",
// "disabled", an extra PostgreSQL parameter. Values are compared with what the standards say, not
// with what the renderer meant.

import { parse } from 'yaml';
import type { Model, Service } from '../../enterprise-architecture/tools/lib/model.ts';
import { siteOf } from '../../enterprise-architecture/tools/lib/net.ts';
import { fail, pass, type Result } from '../../enterprise-architecture/tools/lib/report.ts';

const DOMAIN = 'natax.internal';
const OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;
const IP = String.raw`${OCTET}\.${OCTET}\.${OCTET}\.${OCTET}`;
const CIDR = String.raw`${IP}(?:\/(?:3[0-2]|[12]?\d))?`;
const NAME = String.raw`[a-z0-9][a-z0-9-]*`;
const HOST = String.raw`${NAME}(?:\.${NAME})+`;
const PATH = String.raw`\/[A-Za-z0-9/_.-]*`;
const FILE = String.raw`\/[A-Za-z0-9/_.-]+`;

const published = (model: Model, via: string) => [...model.services.values()].flatMap((service) =>
  (service.provides ?? []).filter((p) => p.via === via).map((provide) => ({ service, provide })));
const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// ---------------------------------------------------------------------------------- HAProxy

type Grammar = Record<string, RegExp[]>;

/** The statements each kind of HAProxy section may contain, as full-line patterns. */
const HAPROXY: Grammar = {
  global: [/^log stdout format raw local0$/, /^maxconn \d+$/, /^ssl-default-bind-options ssl-min-ver TLSv1\.3$/, /^ssl-default-server-options ssl-min-ver TLSv1\.3$/],
  defaults: [/^log global$/, /^timeout (?:connect|client|server) \d+(?:ms|s|m)$/, /^default-server inter \d+s fall \d+ rise \d+$/],
  frontend: [
    /^mode http$/,
    new RegExp(String.raw`^bind ${IP}:443 ssl crt \/etc\/haproxy\/certs\/ alpn h2,http\/1\.1$`),
    /^option forwardfor$/,
    /^http-request deny deny_status 404 if \{ path_beg \/health\/ \}$/,
    new RegExp(String.raw`^http-request deny deny_status 403 if \{ src ${CIDR}(?: ${CIDR})* \} !\{ req\.hdr\(host\),field\(1,:\) -i ${HOST}(?: ${HOST})* \}$`),
    new RegExp(String.raw`^http-request deny deny_status 403 if !\{ src ${CIDR}(?: ${CIDR})* \}$`),
    /^http-request return status 503 content-type text\/plain string "Busy, please retry" if \{ fe_conn gt \d+ \}$/,
    /^maxconn \d+$/,
    new RegExp(String.raw`^use_backend ${NAME} if \{ req\.hdr\(host\),field\(1,:\) -i ${HOST} \}$`),
    /^default_backend unknown-application$/,
  ],
  backend: [
    /^mode http$/, /^balance leastconn$/, /^option httpchk$/,
    new RegExp(String.raw`^http-check send meth GET uri ${PATH} ver HTTP\/1\.1 hdr Host ${HOST}$`),
    /^http-check expect status 200$/, /^timeout queue \d+s$/,
    new RegExp(String.raw`^server ${NAME} ${IP}:\d+ check(?: port \d+)? ssl verify required ca-file ${FILE} sni str\(${HOST}\) verifyhost ${HOST} maxconn \d+(?: backup)?$`),
  ],
  'backend unknown-application': [/^mode http$/, /^http-request return status 404 content-type text\/plain string "Unknown application"$/],
  listen: [
    /^mode tcp$/, new RegExp(String.raw`^bind ${IP}:\d+$`), /^timeout (?:client|server) \d+m$/, /^option httpchk$/,
    new RegExp(String.raw`^http-check send meth GET uri ${PATH}$`), /^http-check expect status 200$/,
    /^default-server inter \d+s fall \d+ rise \d+ on-marked-down shutdown-sessions$/,
    new RegExp(String.raw`^server ${NAME} ${IP}:\d+ check port \d+ check-ssl verify required ca-file ${FILE} verifyhost ${HOST}$`),
  ],
};

/** HAProxy sections and their lines; throws on anything outside the grammar. */
export function haproxySections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: { name: string; kind: string } | undefined;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (raw.includes('#')) throw new Error(`A comment inside a statement isn't in the grammar: ${raw.trim()}`);
    const line = raw.trim().replace(/\s+/g, ' ');
    if (!/^\s/.test(raw)) {
      const m = /^(global|defaults|frontend apps|backend unknown-application|backend [a-z0-9-]+|listen [a-z0-9-]+)$/.exec(line);
      if (!m) throw new Error(`Section not in the grammar: ${line}`);
      if (sections.has(line)) throw new Error(`Section defined twice: ${line}`);
      const kind = line === 'frontend apps' ? 'frontend' : line === 'backend unknown-application' ? line : line.split(' ')[0]!;
      current = { name: line, kind };
      sections.set(line, []);
      continue;
    }
    if (!current) throw new Error(`Statement outside a section: ${line}`);
    if (!HAPROXY[current.kind]!.some((re) => re.test(line))) throw new Error(`Not in the reader's grammar for "${current.name}", so not trusted: ${line}`);
    sections.get(current.name)!.push(line);
  }
  return sections;
}

function checkHaproxy(model: Model, site: string, vip: string, sections: Map<string, string[]>): string[] {
  const found: string[] = [];
  const one = (lines: string[], prefix: string) => lines.filter((l) => l.startsWith(prefix));
  const global = sections.get('global') ?? [];
  if (!global.includes('ssl-default-bind-options ssl-min-ver TLSv1.3') || !global.includes('ssl-default-server-options ssl-min-ver TLSv1.3')) found.push('TLS below 1.3 is allowed');
  const front = sections.get('frontend apps') ?? [];
  if (!front.includes(`bind ${vip}:443 ssl crt /etc/haproxy/certs/ alpn h2,http/1.1`)) found.push(`the frontend isn't bound to ${vip}:443 with TLS`);
  if (!front.includes('http-request deny deny_status 404 if { path_beg /health/ }')) found.push('clients can call /health/* through the load balancer');
  if (!front.some((l) => l.startsWith('http-request return status 503'))) found.push('overload queues instead of answering 503');

  // Which hosts each source may ask for, from the intent: every consumer of a published app.
  const apps = published(model, 'platform-lb').filter((p) => p.service.kind !== 'database-cluster');
  const expected = new Map<string, { addresses: string[]; hosts: string[] }>();
  for (const { service, provide } of apps) {
    for (const consumer of Array.isArray(provide.consumers) ? provide.consumers : []) {
      const zone = consumer.startsWith('zone:') ? model.landscape.zones[consumer.slice(5)] : undefined;
      const svc = zone ? undefined : model.services.get(consumer);
      const addresses = zone ? zone.cidrs : (svc?.egress ?? svc?.instances ?? []).map((i) => i.address);
      const e = expected.get(consumer) ?? { addresses, hosts: [] };
      e.hosts.push(`${service.id}.${DOMAIN}`);
      expected.set(consumer, e);
    }
  }
  const limits = front.filter((l) => l.startsWith('http-request deny deny_status 403 if { src ')).map((l) => {
    const m = /\{ src (.+?) \} !\{ req\.hdr\(host\),field\(1,:\) -i (.+) \}$/.exec(l)!;
    return { addresses: m[1]!.split(' '), hosts: m[2]!.split(' ') };
  });
  for (const [consumer, e] of expected) {
    const limit = limits.find((x) => sameSet(x.addresses, [...new Set(e.addresses)]));
    if (!limit) found.push(`${consumer} isn't limited to its applications' hostnames`);
    else if (!sameSet(limit.hosts, [...new Set(e.hosts)])) found.push(`${consumer} may name ${limit.hosts.join(', ')}, not exactly ${e.hosts.join(', ')}`);
  }
  if (limits.length !== expected.size) found.push(`${limits.length} host limits for ${expected.size} consumers`);
  // A source that consumes nothing published here may name nothing.
  const everyone = [...new Set([...expected.values()].flatMap((e) => e.addresses))];
  const catchAll = front.find((l) => l.startsWith('http-request deny deny_status 403 if !{ src '));
  const covered = catchAll ? catchAll.slice('http-request deny deny_status 403 if !{ src '.length, -' }'.length).split(' ') : [];
  if (everyone.length && !sameSet(covered, everyone)) found.push('sources that consume nothing here may name any application');

  for (const { service, provide } of published(model, 'platform-lb')) {
    const isDb = service.kind === 'database-cluster';
    const lines = sections.get(`${isDb ? 'listen' : 'backend'} ${service.id}`);
    if (!lines) { found.push(`no ${isDb ? 'listen' : 'backend'} for ${service.id}`); continue; }
    const host = `${service.id}.${DOMAIN}`;
    const sends = one(lines, 'http-check send');
    const path = provide.health?.path ?? '?';
    if (!lines.includes('option httpchk') || sends.length !== 1 || !sends[0]!.split(' ').includes(path)) found.push(`${service.id} isn't checked on exactly ${path}`);
    if (!isDb && sends[0] && !sends[0].endsWith(`hdr Host ${host}`)) found.push(`${service.id}'s health check asks for another host`);
    if (!lines.includes('http-check expect status 200')) found.push(`${service.id} doesn't require status 200`);
    const servers = one(lines, 'server ').map((l) => l.split(' '));
    const want = service.instances.map((i) => `${i.address}:${provide.port}`);
    if (!sameSet(servers.map((s) => s[2]!), want)) found.push(`${service.id}'s servers aren't exactly ${want.join(', ')}`);
    for (const s of servers) {
      const address = s[2]!.split(':')[0]!;
      const healthPort = provide.health && provide.health.port !== provide.port ? provide.health.port : undefined;
      if (healthPort !== undefined && !s.join(' ').includes(` check port ${healthPort}`)) found.push(`${service.id} ${address} isn't checked on port ${healthPort}`);
      if (isDb) continue;
      if (!s.includes(`str(${host})`) || s[s.indexOf('verifyhost') + 1] !== host) found.push(`${service.id} ${address} doesn't verify it is ${host}`);
      const local = siteOf(address, model.landscape.sites) === site;
      if (local === s.includes('backup')) found.push(`${service.id} ${address} is ${local ? 'a backup in its own datacenter' : 'active from the other datacenter'}`);
    }
    if (isDb) {
      if (!lines.includes(`bind ${vip}:${provide['frontend-port'] ?? provide.port}`)) found.push(`${service.id} isn't bound to ${vip}:${provide['frontend-port'] ?? provide.port}`);
      if (!lines.some((l) => l.endsWith('on-marked-down shutdown-sessions'))) found.push(`${service.id} keeps connections to a demoted primary`);
    } else if (!front.includes(`use_backend ${service.id} if { req.hdr(host),field(1,:) -i ${host} }`)) found.push(`no route to ${service.id}`);
  }
  const extra = [...sections.keys()].filter((k) => /^(backend|listen) /.test(k) && k !== 'backend unknown-application'
    && !published(model, 'platform-lb').some((p) => k === `${p.service.kind === 'database-cluster' ? 'listen' : 'backend'} ${p.service.id}`));
  if (extra.length) found.push(`sections nothing declares: ${extra.join(', ')}`);
  return found;
}

// ---------------------------------------------------------------------------------- keepalived

interface Block { name: string; lines: string[]; blocks: Block[] }

/** keepalived's own syntax: "#" and "!" start a comment anywhere outside quotes; blocks are braces. */
export function keepalivedBlocks(text: string): Block {
  const root: Block = { name: '', lines: [], blocks: [] };
  const stack = [root];
  for (const raw of text.split('\n')) {
    let line = '';
    let quoted = false;
    for (const ch of raw) { if (ch === '"') quoted = !quoted; if (!quoted && (ch === '#' || ch === '!')) break; line += ch; }
    line = line.trim().replace(/\s+/g, ' ');
    if (!line) continue;
    if (line === '}') { stack.pop(); if (!stack.length) throw new Error('Unbalanced braces.'); continue; }
    if (line.endsWith(' {')) { const b: Block = { name: line.slice(0, -2), lines: [], blocks: [] }; stack.at(-1)!.blocks.push(b); stack.push(b); continue; }
    stack.at(-1)!.lines.push(line);
  }
  if (stack.length !== 1) throw new Error('Unbalanced braces.');
  return root;
}

const KEEPALIVED: Record<string, RegExp[]> = {
  vrrp_script: [/^script "[^"]+"$/, /^(?:interval|fall|rise) \d+$/],
  vrrp_instance: [/^state (?:BACKUP|MASTER)$/, /^nopreempt$/, /^interface [a-z0-9]+$/, /^virtual_router_id \d+$/, /^advert_int \d+$/, /^priority \d+$/, new RegExp(String.raw`^unicast_src_ip ${IP}$`)],
  unicast_peer: [new RegExp(String.raw`^${IP}$`)],
  virtual_ipaddress: [new RegExp(String.raw`^${CIDR}$`)],
  track_script: [/^[a-z_]+$/],
};

function checkKeepalived(node: string, site: string, vip: string, peers: string[], text: string): string[] {
  const root = keepalivedBlocks(text);
  const found: string[] = [];
  const walk = (b: Block) => {
    const kind = b.name.split(' ')[0]!;
    if (b !== root) {
      if (!KEEPALIVED[kind]) throw new Error(`Block not in the grammar: ${b.name}`);
      for (const l of b.lines) if (!KEEPALIVED[kind]!.some((re) => re.test(l))) throw new Error(`Not in the reader's grammar for ${kind}, so not trusted: ${l}`);
    } else if (b.lines.length) throw new Error(`Statement outside a block: ${b.lines[0]}`);
    b.blocks.forEach(walk);
  };
  walk(root);
  const instances = root.blocks.filter((b) => b.name.startsWith('vrrp_instance '));
  const scripts = root.blocks.filter((b) => b.name.startsWith('vrrp_script '));
  if (instances.length !== 1) return [`${node} has ${instances.length} VRRP instances, not 1`];
  const inst = instances[0]!;
  const sub = (name: string) => inst.blocks.find((b) => b.name === name)?.lines ?? [];
  if (!inst.lines.includes(`unicast_src_ip ${node}`)) found.push(`${node} doesn't speak VRRP from its own address`);
  if (!sameSet(sub('unicast_peer'), peers)) found.push(`${node}'s peers aren't exactly ${peers.join(', ')}`);
  if (!sameSet(sub('virtual_ipaddress').map((v) => v.split('/')[0]!), [vip])) found.push(`${node} doesn't carry exactly the ${site} VIP ${vip}`);
  const tracked = sub('track_script');
  const tracksHaproxy = tracked.some((t) => scripts.some((s) => s.name === `vrrp_script ${t}` && s.lines.some((l) => /^script ".*\bhaproxy\b.*"$/.test(l))));
  if (!tracksHaproxy) found.push(`${node} doesn't give up the VIP when HAProxy dies`);
  return found;
}

// ---------------------------------------------------------------------------------- Patroni, pgBackRest, etcd

/** What the standards require of Patroni's dynamic settings for a cluster (INF-05, RES-05, DAT-08). */
export function requiredDcs(cluster: Service): unknown {
  return {
    ttl: 30, loop_wait: 10, retry_timeout: 10,
    synchronous_mode: true, synchronous_mode_strict: false, synchronous_node_count: 1,
    postgresql: {
      use_pg_rewind: true,
      parameters: {
        max_connections: cluster['max-connections'],
        synchronous_commit: 'on', ssl: 'on', ssl_min_protocol_version: 'TLSv1.3',
        archive_mode: 'on', archive_command: `pgbackrest --stanza=${cluster.id} archive-push %p`,
      },
    },
  };
}

/** Exact comparison: a missing, extra or different setting is a difference. */
export function differences(actual: unknown, required: unknown, path = ''): string[] {
  if (typeof required === 'object' && required !== null) {
    if (typeof actual !== 'object' || actual === null) return [`${path || 'settings'} is missing`];
    const a = actual as Record<string, unknown>;
    const r = required as Record<string, unknown>;
    return [
      ...Object.keys(r).flatMap((k) => differences(a[k], r[k], path ? `${path}.${k}` : k)),
      ...Object.keys(a).filter((k) => !(k in r)).map((k) => `${path ? `${path}.` : ''}${k} isn't in the standard`),
    ];
  }
  return actual === required ? [] : [`${path} is ${JSON.stringify(actual)}, not ${JSON.stringify(required)}`];
}

function checkPatroni(model: Model, db: Service, yml: string, dcsYml: string): string[] {
  const found: string[] = [];
  const cfg = parse(yml) as Record<string, any>;
  const dcs = parse(dcsYml);
  found.push(...differences(dcs, requiredDcs(db)).map((d) => `dynamic settings: ${d}`));
  found.push(...differences(cfg['bootstrap'], { dcs: requiredDcs(db) }).map((d) => `bootstrap: ${d}`));
  const allowed: Record<string, string[]> = {
    '': ['scope', 'etcd3', 'bootstrap', 'watchdog', 'tags'],
    etcd3: ['protocol', 'hosts', 'cacert', 'cert', 'key', 'username'],
    watchdog: ['mode', 'device', 'safety_margin'],
    tags: ['nofailover'],
  };
  for (const [at, keys] of Object.entries(allowed)) {
    const obj = at ? cfg[at] : cfg;
    for (const k of Object.keys(obj ?? {})) if (!keys.includes(k)) found.push(`${at ? `${at}.` : ''}${k} isn't in the standard${k === 'password' ? ' (and a password never belongs in a file)' : ''}`);
  }
  if (cfg['scope'] !== db.id) found.push(`scope is ${cfg['scope']}, not ${db.id}`);
  if (cfg['watchdog']?.mode !== 'required') found.push(`watchdog "${cfg['watchdog']?.mode}", so a primary that loses its lock may keep writing`);
  if (cfg['tags']?.nofailover !== false) found.push('it can never fail over');
  const hosts: string[] = cfg['etcd3']?.hosts ?? [];
  const sites = new Set(hosts.map((h) => siteOf(String(h).split(':')[0]!, model.landscape.sites)));
  if (hosts.length !== 3 || sites.size !== 3 || sites.has(undefined)) found.push('the quorum isn\'t three members in three sites');
  if (cfg['etcd3']?.protocol !== 'https') found.push('quorum traffic isn\'t encrypted');
  if (cfg['etcd3']?.username !== `patroni-${db.id}`) found.push('it doesn\'t use its own etcd user');
  return found;
}

const PGBACKREST = [/^\[[a-z0-9-]+\]$/, /^repo\d-host=[\d.]+$/, /^repo\d-host-type=tls$/, /^repo\d-retention-full=\d+$/, /^archive-async=y$/, /^archive-push-queue-max=\d+(?:MiB|GiB)$/, /^pg1-path=\/[\w/.-]+$/];

function checkPgBackRest(model: Model, db: Service, text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const bad = lines.find((l) => !PGBACKREST.some((re) => re.test(l)));
  if (bad) throw new Error(`Not in the reader's grammar for pgBackRest, so not trusted: ${bad}`);
  const found: string[] = [];
  const repos = lines.filter((l) => /^repo\d-host=/.test(l)).map((l) => l.split('=')[1]!);
  const want = (model.services.get('backup-store')?.instances ?? []).map((i) => i.address);
  if (!sameSet(repos, want)) found.push(`${db.id} archives to ${repos.join(', ') || 'nowhere'}, not to both datacenters (${want.join(', ')})`);
  if (!lines.includes('archive-async=y') || !lines.some((l) => l.startsWith('archive-push-queue-max='))) found.push(`${db.id} can fill the primary's disk waiting for a repository`);
  if (!lines.includes(`[${db.id}]`)) found.push(`no stanza for ${db.id}`);
  return found;
}

// ---------------------------------------------------------------------------------- all of it

export function checkGeneratedConfig(model: Model, files: Map<string, string>): Result[] {
  const results: Result[] = [];
  const reader = (rule: string, what: string, read: () => string[], ok: string) => {
    try {
      const found = read();
      results.push(found.length ? fail(rule, `${what}: ${found.join('; ')}.`, 'Fix the renderer, then regenerate.') : pass(rule, ok));
    } catch (e) {
      results.push(fail('DEL-06', `${what} can't be read back: ${(e as Error).message}`, 'Fix the renderer: configuration nobody can verify is never assumed correct.'));
    }
  };
  const need = (file: string) => { const t = files.get(file); if (t === undefined) throw new Error('the file is missing'); return t; };
  const lb = model.services.get('platform-lb');

  for (const vip of lb?.vips ?? []) {
    const file = `haproxy/platform-lb-${vip.site}.cfg`;
    reader('RES-06', file, () => checkHaproxy(model, vip.site, vip.address, haproxySections(need(file))),
      `${file}: every published service checked on its readiness path over verified TLS, with exactly its instances; each source limited to its applications; /health/* closed to clients.`);
  }
  for (const node of lb?.instances ?? []) {
    const file = `keepalived/platform-lb-${node.address}.conf`;
    const vip = lb!.vips!.find((v) => v.site === node.site)!.address;
    const peers = lb!.instances.filter((i) => i.site === node.site && i.address !== node.address).map((i) => i.address);
    reader('RES-02', file, () => checkKeepalived(node.address, node.site, vip, peers, need(file)), `${file}: carries the ${node.site} VIP with its peer, and gives it up when HAProxy dies.`);
  }
  const clusters = [...model.services.values()].filter((s) => s.kind === 'database-cluster' && s.replication);
  for (const db of clusters) {
    reader('RES-05', `patroni/${db.id}.yml`, () => checkPatroni(model, db, need(`patroni/${db.id}.yml`), need(`patroni/${db.id}.dcs.yml`)),
      `patroni/${db.id}: exactly the standard's settings, for new and running clusters; watchdog fencing; quorum across three sites; its own etcd user.`);
    reader('DAT-08', `pgbackrest/${db.id}.conf`, () => checkPgBackRest(model, db, need(`pgbackrest/${db.id}.conf`)),
      `pgbackrest/${db.id}: archives to both datacenters, without ever filling the primary's disk.`);
  }
  reader('SEC-09', 'etcd/rbac.yaml', () => {
    const rbac = parse(need('etcd/rbac.yaml')) as { auth?: string; authentication?: string; roles?: { role: string; 'readwrite-prefix'?: string; 'read-prefix'?: string }[]; users?: { user: string; roles?: string[] }[] };
    const found: string[] = [];
    if (rbac.auth !== 'enabled' || rbac.authentication !== 'password') found.push('authentication isn\'t enabled with passwords');
    if (!rbac.users?.some((u) => u.user === 'root' && u.roles?.includes('root'))) found.push('there is no root user, so authentication can\'t be enabled');
    for (const u of rbac.users ?? []) {
      if (u.user === 'root') continue;
      const db = clusters.find((c) => u.user === `patroni-${c.id}`);
      if (!db) { found.push(`user ${u.user} isn't a declared cluster`); continue; }
      const prefixes = (u.roles ?? []).flatMap((r) => rbac.roles?.filter((x) => x.role === r) ?? []).flatMap((x) => [x['readwrite-prefix'], x['read-prefix']]).filter(Boolean);
      if (prefixes.length === 0 || prefixes.some((p) => p !== `/service/${db.id}/`)) found.push(`${u.user} can reach ${prefixes.join(', ') || 'nothing'}, not only /service/${db.id}/`);
    }
    for (const db of clusters) if (!rbac.users?.some((u) => u.user === `patroni-${db.id}`)) found.push(`no etcd user for ${db.id}`);
    return found;
  }, 'Each database cluster\'s etcd user can touch only its own keys; a root user exists to enable authentication.');

  reader('RES-06', 'edge/health-checks.yaml', () => {
    type Monitor = { protocol?: string; path?: string; 'expect-status'?: number; targets?: { site: string; address: string }[] };
    const edge = parse(need('edge/health-checks.yaml')) as { services?: { name: string; pool?: { address: string }[]; monitor?: Monitor; 'client-blocked-paths'?: string[] }[]; 'internal-global'?: { name: string; monitor?: Monitor }[] };
    const found: string[] = [];
    for (const { service, provide } of published(model, 'edge-adc')) {
      const entry = edge.services?.find((e) => e.name === `${service.id}/${provide.name}`);
      if (!entry) { found.push(`no monitor for ${service.id}/${provide.name}`); continue; }
      if (entry.monitor?.path !== provide.health?.path || entry.monitor?.protocol !== 'https' || entry.monitor?.['expect-status'] !== 200) found.push(`${service.id} isn't monitored on ${provide.health?.path} over HTTPS`);
      if (!sameSet((entry.pool ?? []).map((p) => p.address), service.instances.map((i) => i.address))) found.push(`${service.id}'s pool isn't exactly its instances`);
      if (!(entry['client-blocked-paths'] ?? []).includes('/health/')) found.push(`${service.id} forwards /health/* from the internet`);
    }
    for (const { service, provide } of published(model, 'platform-lb').filter((p) => p.service.kind !== 'database-cluster')) {
      const entry = edge['internal-global']?.find((e) => e.name === `${service.id}.${DOMAIN}`);
      if (!entry) { found.push(`no global DNS entry for ${service.id}`); continue; }
      if (entry.monitor?.path !== provide.health?.path) found.push(`${service.id}'s global monitor isn't on ${provide.health?.path}`);
      for (const site of ['dc1', 'dc2']) {
        const targets = (entry.monitor?.targets ?? []).filter((t) => t.site === site).map((t) => t.address);
        const local = service.instances.filter((i) => i.site === site).map((i) => i.address);
        if (!sameSet(targets, local)) found.push(`${service.id}'s ${site} monitor checks ${targets.join(', ') || 'nothing'}, not exactly its own instances there (through the VIP, the other datacenter would answer)`);
      }
    }
    return found;
  }, 'Every service is monitored on its readiness path, on exactly the instances of the site it judges.');
  return results;
}

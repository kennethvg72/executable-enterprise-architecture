// Tests for the infrastructure checks and the failure simulation. Each test makes one
// realistic mistake in a copy of the landscape and checks that it is caught.

// The authorities (real nftables, HAProxy) have their own tests: npm run test:authority.
process.env.NATAX_AUTHORITIES = 'off';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { parse } from 'yaml';
import { compareConfig, fetchConfig } from './check-patroni-config.ts';
import { REPO_ROOT, clone, loadLandscape, loadModel, withApplications } from '../../enterprise-architecture/tools/lib/load.ts';
const FIXTURE = join(REPO_ROOT, 'enterprise-architecture', 'tools', 'fixtures', 'registered-app');
import type { Landscape, Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { checkGeneratedConfig } from './check-output.ts';
import { renderAll } from './render.ts';
import { simulate } from './simulate.ts';
import { checkCapacity, checkDatabases, checkLoadBalancers, checkPlacement, checkTopology } from './verify.ts';

const withLandscape = (change: (l: Landscape) => void): Model => {
  const landscape = clone(loadLandscape());
  change(landscape);
  return loadModel(undefined, landscape);
};
const failed = (results: { status: string; rule: string }[], rule: string) => results.some((r) => r.status === 'fail' && r.rule === rule);

test('the current landscape passes every infrastructure check', () => {
  const model = loadModel();
  for (const results of [checkLoadBalancers(model), checkDatabases(model), checkPlacement(model), checkCapacity(model), checkTopology(model)]) {
    assert.deepEqual(results.filter((r) => r.status === 'fail'), []);
  }
});

test('a health check that only proves the port is open is caught (RES-06)', () => {
  const model = loadModel();
  model.services.get('rejection-triage')!.provides![0]!.health = { port: 8443, path: '/' };
  assert.ok(failed(checkLoadBalancers(model), 'RES-06'));
});

test('strict synchronous replication is caught: it turns a replica failure into an outage (RES-05)', () => {
  const model = withLandscape((l) => { l.services['app-db']!.replication!.strict = true; });
  assert.ok(failed(checkDatabases(model), 'RES-05'));
});

test('a primary without watchdog fencing is caught (RES-05)', () => {
  const model = withLandscape((l) => { l.services['core-db']!.replication!.watchdog = 'off'; });
  assert.ok(failed(checkDatabases(model), 'RES-05'));
});

test('an out-of-band witness is caught, and the simulation shows why (RES-04)', () => {
  const model = withLandscape((l) => {
    for (const link of l.links) if (link.between.includes('hq') && !link.between.includes('internet')) link.network = 'internet-vpn';
  });
  assert.ok(failed(checkTopology(model), 'RES-04'));
});

test('HQ without transit is caught (RES-04)', () => {
  const model = withLandscape((l) => { l.sites['hq']!.transit = false; });
  assert.ok(failed(checkTopology(model), 'RES-04'));
});

test('a datacenter that cannot carry the planning peak alone is caught (RES-03)', () => {
  const model = withLandscape((l) => { l.services['filing-web']!['peak-vcpu'] = 1000; });
  assert.ok(failed(checkCapacity(model), 'RES-03'));
});

test('an application whose instances cannot carry its planning peak from one site is caught (RES-03)', () => {
  const model = withApplications(loadModel(), [FIXTURE]);
  model.manifests.get('rejection-triage')!.manifest.runtime.capacity['instance-requests-per-second'] = 10;
  assert.ok(failed(checkPlacement(model), 'RES-03'));
});

test('simulation: a fiber cut with an in-band witness changes nothing users can see', () => {
  const o = simulate(loadLandscape(), { name: 'cut', linksDown: [['dc1', 'dc2']] });
  assert.equal(o.verdict, 'ok');
  assert.equal(o.primary, 'dc1');
  assert.equal(o.syncReplica, true);
  assert.deepEqual(o.serving, ['dc1', 'dc2']);
});

test('simulation: the same fiber cut with an out-of-band witness is split but quorate', () => {
  const o = simulate(loadLandscape(), { name: 'cut', linksDown: [['dc1', 'dc2']], outOfBandWitness: true });
  assert.equal(o.verdict, 'danger');
  assert.deepEqual(o.quorum, ['dc1', 'dc2', 'hq'], 'every member still believes it has quorum');
  assert.equal(o.syncReplica, false, 'the primary has silently lost its synchronous replica');
  assert.deepEqual(o.serving, ['dc1']);
});

test('simulation: losing the primary datacenter promotes the synchronous replica', () => {
  const o = simulate(loadLandscape(), { name: 'dc1', sitesDown: ['dc1'] });
  assert.equal(o.primary, 'dc2');
  assert.equal(o.verdict, 'degraded');
});

test('simulation: an isolated datacenter loses quorum and fences itself, and is withdrawn', () => {
  const o = simulate(loadLandscape(), { name: 'isolated', linksDown: [['dc1', 'dc2'], ['dc1', 'hq']] });
  assert.equal(o.primary, 'dc2');
  assert.ok(!o.quorum.includes('dc1'));
  assert.deepEqual(o.serving, ['dc2']);
});

test('simulation: two failures at once stop writes, but never cause split brain', () => {
  const o = simulate(loadLandscape(), { name: 'double', sitesDown: ['hq'], linksDown: [['dc1', 'dc2']] });
  assert.equal(o.verdict, 'outage');
  assert.equal(o.primary, null);
});

test('the generated configuration is verified as written, so a renderer bug is caught (DEL-06)', () => {
  const model = loadModel();
  const rendered = renderAll(model);
  assert.deepEqual(checkGeneratedConfig(model, rendered).filter((r) => r.status === 'fail'), []);
  // Each mutation is a renderer bug that the model-level checks and the drift check can't see.
  const mutations: [string, string, (text: string) => string, string][] = [
    ['patroni/core-db.yml', 'watchdog off', (t) => t.replace('mode: required', 'mode: off'), 'RES-05'],
    ['patroni/app-db.yml', 'strict synchronous mode', (t) => t.replace('synchronous_mode_strict: false', 'synchronous_mode_strict: true'), 'RES-05'],
    ['haproxy/platform-lb-dc1.cfg', 'health check removed', (t) => t.replace(/ {2}http-check send meth GET uri \/health\/ready[^\n]*\n/, ''), 'RES-06'],
    ['haproxy/platform-lb-dc1.cfg', 'demoted primary keeps connections', (t) => t.replace('on-marked-down shutdown-sessions', ''), 'RES-06'],
    ['haproxy/platform-lb-dc2.cfg', 'other datacenter active', (t) => t.replace(/( server dc1-1 [^\n]*) backup/, '$1'), 'RES-06'],
    ['edge/health-checks.yaml', 'edge monitors the root page', (t) => t.replace('path: /health/ready', 'path: /'), 'RES-06'],
    ['keepalived/platform-lb-10.1.50.11.conf', 'VIP stays when HAProxy dies', (t) => t.replace(/track_script \{[^}]*\}/, ''), 'RES-02'],
    ['patroni/core-db.dcs.yml', 'the running cluster turns strict', (t) => t.replace('synchronous_mode_strict: false', 'synchronous_mode_strict: true'), 'RES-05'],
    ['patroni/app-db.yml', 'a cluster without its own etcd user', (t) => t.replace(/ {2}username: [^\n]*\n/, ''), 'RES-05'],
    ['etcd/rbac.yaml', 'one cluster can write another\'s keys', (t) => t.replace('readwrite-prefix: /service/app-db/', 'readwrite-prefix: /service/'), 'SEC-09'],
    ['etcd/rbac.yaml', 'no root user, so authentication can never be enabled', (t) => t.replace(/ {2}- user: root\n {4}roles: \[root\]\n/, ''), 'SEC-09'],
    ['haproxy/platform-lb-dc1.cfg', 'clients can flood /health/ready', (t) => t.replace(/ {2}http-request deny deny_status 404[^\n]*\n/, ''), 'RES-06'],
    ['edge/health-checks.yaml', 'the internet can flood /health/ready', (t) => t.replace('client-blocked-paths: [/health/]', 'client-blocked-paths: []'), 'RES-06'],
    // Round 2's hand-crafted configurations: valid to HAProxy, keepalived and Patroni, dangerous to NATAX.
    ['haproxy/platform-lb-dc1.cfg', 'health checks switched off again', (t) => t.replace('  option httpchk\n', '  option httpchk\n  no option httpchk\n'), 'DEL-06'],
    ['haproxy/platform-lb-dc1.cfg', 'certificates not verified', (t) => t.replace('ssl verify required', 'ssl verify none'), 'DEL-06'],
    ['haproxy/platform-lb-dc1.cfg', 'a server disabled', (t) => t.replace(/( server dc1-1 [^\n]*maxconn 200)/, '$1 disabled'), 'DEL-06'],
    ['haproxy/platform-lb-dc1.cfg', 'a backup flag hidden in a comment', (t) => t.replace(/( server dc2-1 [^\n]*maxconn 200) backup/, '$1 # backup'), 'DEL-06'],
    ['haproxy/platform-lb-dc1.cfg', 'TLS 1.0 allowed', (t) => t.replace('ssl-default-server-options ssl-min-ver TLSv1.3', 'ssl-default-server-options ssl-min-ver TLSv1.0'), 'DEL-06'],
    ['haproxy/platform-lb-dc1.cfg', 'a second health check on the root page', (t) => t.replace(/( {2}http-check send meth GET uri \/health\/ready[^\n]*\n)/, '$1  http-check send meth GET uri / ver HTTP/1.1 hdr Host rejection-triage.natax.internal\n'), 'RES-06'],
    ['haproxy/platform-lb-dc1.cfg', 'any status counts as healthy', (t) => t.replace('  http-check expect status 200\n', '  http-check expect status 200-499\n'), 'DEL-06'],
    ['haproxy/platform-lb-dc1.cfg', 'a server that isn\'t an instance', (t) => t.replace(/( server dc1-1 [^\n]*\n)/, '$1  server dc1-9 10.1.20.99:8443 check ssl verify required ca-file /etc/haproxy/ca/natax-workload-ca.pem sni str(rejection-triage.natax.internal) verifyhost rejection-triage.natax.internal maxconn 200\n'), 'RES-06'],
    ['haproxy/platform-lb-dc1.cfg', 'a backend nothing declares', (t) => t.replace('backend unknown-application', 'backend shadow-app\n  mode http\n  balance leastconn\n\nbackend unknown-application'), 'RES-06'],
    ['haproxy/platform-lb-dc1.cfg', 'staff may name any application', (t) => t.replace(/( {2}http-request deny deny_status 403[^\n]*-i [^\n]*) \}/, '$1 payments.natax.internal }'), 'RES-06'],
    ['haproxy/platform-lb-dc1.cfg', 'no host limit for staff', (t) => t.replace(/ {2}http-request deny deny_status 403 if \{ src [^\n]*\n/, ''), 'RES-06'],
    ['haproxy/platform-lb-dc1.cfg', 'sources that consume nothing may name anything', (t) => t.replace(/ {2}http-request deny deny_status 403 if !\{ src [^\n]*\n/, ''), 'RES-06'],
    ['haproxy/platform-lb-dc1.cfg', 'round robin instead of least connections', (t) => t.replace('balance leastconn', 'balance roundrobin'), 'DEL-06'],
    ['haproxy/platform-lb-dc1.cfg', 'unknown hosts sent to an application', (t) => t.replace('default_backend unknown-application', 'default_backend rejection-triage'), 'DEL-06'],
    ['keepalived/platform-lb-10.1.50.11.conf', 'the VIP only in a comment', (t) => t.replace(/( {4})(10\.1\.50\.10\/24)/, '$1# $2'), 'RES-02'],
    ['keepalived/platform-lb-10.1.50.11.conf', 'a second VIP', (t) => t.replace(/( {4}10\.1\.50\.10\/24\n)/, '$1    10.1.50.99/24\n'), 'RES-02'],
    ['keepalived/platform-lb-10.1.50.11.conf', 'a health script that always succeeds', (t) => t.replace(/script "[^"]*"/, 'script "/bin/true"'), 'RES-02'],
    ['keepalived/platform-lb-10.1.50.11.conf', 'a keyword nobody modeled', (t) => t.replace('  nopreempt\n', '  nopreempt\n  garp_master_delay 1\n'), 'DEL-06'],
    ['patroni/core-db.dcs.yml', 'a leader TTL shorter than the WAN reroute', (t) => t.replace(/^ttl: 30/m, 'ttl: 5'), 'RES-05'],
    ['patroni/core-db.dcs.yml', 'commits that don\'t wait for the replica', (t) => t.replace('synchronous_commit: "on"', 'synchronous_commit: "off"'), 'RES-05'],
    ['patroni/core-db.dcs.yml', 'an extra parameter: fsync off', (t) => t.replace('    ssl: "on"', '    ssl: "on"\n    fsync: "off"'), 'RES-05'],
    ['patroni/core-db.dcs.yml', 'WAL archived to the local disk only', (t) => t.replace(/archive_command: "[^"]*"/, 'archive_command: "cp %p /var/tmp/%f"'), 'RES-05'],
    ['patroni/core-db.yml', 'a password in the file', (t) => t.replace('  username: patroni-core-db', '  username: patroni-core-db\n  password: hunter2hunter2'), 'RES-05'],
    ['patroni/core-db.yml', 'watchdog only if available', (t) => t.replace('mode: required', 'mode: automatic'), 'RES-05'],
    ['pgbackrest/core-db.conf', 'archived to one datacenter only', (t) => t.replace(/# backup-store in dc2\nrepo2-host=[^\n]*\nrepo2-host-type=tls\nrepo2-retention-full=4\n/, ''), 'DAT-08'],
    ['pgbackrest/core-db.conf', 'an unreachable repository fills the disk', (t) => t.replace('archive-push-queue-max=4GiB\n', ''), 'DAT-08'],
    ['pgbackrest/core-db.conf', 'a repository over SSH', (t) => t.replace('repo2-host-type=tls', 'repo2-host-type=ssh'), 'DEL-06'],
    ['edge/health-checks.yaml', 'the global monitor checks the VIP', (t) => t.replace('        - { site: dc1, address: 10.1.20.31, port: 8443 }', '        - { site: dc1, address: 10.1.50.10, port: 443 }'), 'RES-06'],
  ];
  for (const [file, name, mutate, rule] of mutations) {
    const files = new Map(rendered);
    const before = files.get(file)!;
    files.set(file, mutate(before));
    assert.notEqual(files.get(file), before, `the mutation "${name}" didn't apply`);
    const results = checkGeneratedConfig(model, files);
    assert.ok(failed(results, rule) || (rule !== 'DEL-06' && failed(results, 'DEL-06')), `not caught as ${rule}: ${name}`);
  }
});

test('Patroni\'s running settings are compared with what was applied, over its API (DEL-06)', async () => {
  const applied = parse(readFileSync(join(REPO_ROOT, 'infrastructure', 'generated', 'patroni', 'app-db.dcs.yml'), 'utf8'));
  let running: unknown = applied;
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(running)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.deepEqual((await fetchConfig(url) as object), applied);
    assert.deepEqual(compareConfig('app-db', applied, running).map((r) => r.status), ['pass']);
    // A setting changed on the cluster behind the pipeline's back.
    running = { ...(applied as object), synchronous_mode_strict: true };
    assert.ok(compareConfig('app-db', applied, running).some((r) => r.status === 'fail'));
    // A setting someone added: kept by --apply, but never silent.
    running = { ...(applied as object), maximum_lag_on_failover: 1048576 };
    assert.deepEqual(compareConfig('app-db', applied, running).map((r) => r.status), ['pass', 'warn']);
  } finally {
    server.close();
  }
});

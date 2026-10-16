// Tests for the network policy compiler and verifier. Each test makes one realistic mistake
// in a copy of the landscape and checks that the tools catch it, with a path forward.

// The authorities (real nftables, HAProxy) have their own tests: npm run test:authority.
process.env.NATAX_AUTHORITIES = 'off';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { REPO_ROOT, clone, loadLandscape, loadModel, readYaml } from '../../enterprise-architecture/tools/lib/load.ts';
import type { Model } from '../../enterprise-architecture/tools/lib/model.ts';
import { compilePolicy, isAllowed } from './policy.ts';
import { probePlan, renderHostRuleset } from './render.ts';
import { checkEgressAllowlist, checkGeneratedRules, checkInvariants, type Expectation } from './verify.ts';
import { renderAll } from './compile.ts';
import { classify } from './probe.ts';
import { combine } from './probe-report.ts';
import type { Probe } from './render.ts';

const failures = (model: Model) => checkInvariants(model, compilePolicy(model)).filter((r) => r.status === 'fail');
const withLandscape = (change: (l: ReturnType<typeof loadLandscape>) => void) => {
  const landscape = clone(loadLandscape());
  change(landscape);
  return loadModel(undefined, landscape);
};

test('the current landscape compiles without errors and meets every invariant', () => {
  const model = loadModel();
  const policy = compilePolicy(model);
  assert.deepEqual(policy.problems.filter((p) => p.severity === 'error'), []);
  assert.deepEqual(failures(model), []);
});

test('a dependency only one side declared creates no path, and says who must approve', () => {
  const model = withLandscape((l) => {
    const rejections = l.services['efile-gateway']!.provides!.find((p) => p.name === 'rejections-api')!;
    rejections.consumers = [];
  });
  const policy = compilePolicy(model);
  const problem = policy.problems.find((p) => p.message.includes('rejection-triage wants efile-gateway'));
  assert.ok(problem, 'expected a problem for the undeclared consumer');
  assert.match(problem.fix, /efile-gateway's owner .* adds rejection-triage/);
  assert.equal(isAllowed(policy, '10.1.20.31', '10.1.20.41', 8444), undefined);
});

test('an application can reach only its own database, and only through the endpoint', () => {
  const policy = compilePolicy(loadModel());
  assert.ok(isAllowed(policy, '10.1.20.31', '10.1.50.10', 5432), 'own database endpoint');
  assert.equal(isAllowed(policy, '10.1.20.31', '10.1.50.10', 5433), undefined, 'taxpayer database endpoint');
  assert.equal(isAllowed(policy, '10.1.20.31', '10.1.30.31', 5432), undefined, 'database node directly');
  assert.equal(isAllowed(policy, '10.1.20.31', '10.2.30.31', 5432), undefined, 'replica in the other datacenter');
});

test('claiming a database you do not own is refused', () => {
  const model = loadModel();
  model.services.get('rejection-triage')!.consumes!.push({ service: 'core-db', interface: 'postgres', database: 'returns' });
  const problem = compilePolicy(model).problems.find((p) => p.message.includes('rejection-triage wants core-db'));
  assert.ok(problem);
  assert.match(problem.fix, /Central IT provisions database "returns"/);
});

test('reaching an external that belongs to a shared service is refused (INT-05)', () => {
  const model = loadModel();
  model.services.get('rejection-triage')!.consumes!.push({ external: 'email-provider' });
  const problem = compilePolicy(model).problems.find((p) => p.rule === 'INT-05');
  assert.ok(problem);
  assert.match(problem.message, /only notification-service may/);
});

test('publishing an application to staff without the load balancer is caught', () => {
  const model = loadModel();
  model.services.get('rejection-triage')!.provides![0]!.via = undefined;
  assert.ok(failures(model).some((r) => r.rule === 'SEC-02' && r.message.includes('zone workforce reaches rejection-triage')));
});

test('an SSH path from anywhere but a PAW is caught (no jump hosts)', () => {
  const model = withLandscape((l) => {
    l['platform-flows'].push({ from: 'data-warehouse', to: 'all-production', port: 22, purpose: 'Convenient admin box' });
  });
  assert.ok(failures(model).some((r) => r.rule === 'IAM-06'));
});

test('a test environment with a path into production is caught (SEC-07)', () => {
  const model = withLandscape((l) => {
    const api = l.services['efile-gateway']!.provides!.find((p) => p.name === 'rejections-api')!;
    (api.consumers as string[]).push('zone:test-acceptance');
  });
  assert.ok(failures(model).some((r) => r.rule === 'SEC-07'));
});

test('locking down HQ transit brings back the split-brain risk, and is caught (RES-04)', () => {
  const model = withLandscape((l) => { l.sites['hq']!.transit = false; });
  const fail = failures(model).find((r) => r.rule === 'RES-04');
  assert.ok(fail);
  assert.match(fail.fix ?? '', /both datacenters seeing the witness but not each other/);
});

test('each host gets a default-deny ruleset that accepts only declared sources', () => {
  const model = loadModel();
  const nft = renderHostRuleset(model.services.get('rejection-triage')!, compilePolicy(model));
  assert.match(nft, /policy drop;/);
  assert.match(nft, /ip saddr \{ 10\.1\.50\.11, 10\.1\.50\.12, 10\.2\.50\.11, 10\.2\.50\.12 \} tcp dport 8443 accept/);
  assert.match(nft, /ip saddr \{ 10\.250\.0\.0\/24, 10\.3\.90\.0\/24 \} tcp dport 22 accept/);
  assert.doesNotMatch(nft, /tcp dport 5432 accept.*\n.*input/); // database only outbound
});

test('drops are logged at a limited rate, not every packet', () => {
  const model = loadModel();
  const nft = renderHostRuleset(model.services.get('rejection-triage')!, compilePolicy(model));
  assert.ok(nft.includes('limit rate 10/second log prefix'));
  assert.doesNotMatch(nft, /log prefix "[^"]*" limit rate/);
});

test('"the internet" never includes NATAX addresses, and load balancer pairs can fail over', () => {
  const model = loadModel();
  const policy = compilePolicy(model);
  assert.ok(renderHostRuleset(model.services.get('egress-proxy')!, policy).includes('ip daddr != 10.0.0.0/8 tcp dport 443 accept'));
  assert.ok(renderHostRuleset(model.services.get('platform-lb')!, policy).includes('ip saddr { 10.1.50.11, 10.1.50.12 } ip protocol vrrp accept'));
});

test('the probe plan covers thousands of paths, both allowed and blocked', () => {
  const model = loadModel();
  const probes = probePlan(model, compilePolicy(model));
  assert.ok(probes.length > 1000);
  const toReplica = probes.find((p) => p.from === '10.1.20.31' && p.to === '10.2.30.31' && p.port === 5432);
  assert.equal(toReplica?.expect, 'blocked');
  const toEndpoint = probes.find((p) => p.from === '10.1.20.31' && p.to === '10.1.50.10' && p.port === 5432);
  assert.equal(toEndpoint?.expect, 'open');
});

test('a probe run passes only with proof: timeouts to a target nobody reached are inconclusive', () => {
  const probe = (to: string, expect: 'open' | 'blocked') => ({ from: '10.1.20.31', fromLabel: 'a', to, toLabel: 'b', port: 5432, expect }) as Parameters<typeof classify>[0][number]['probe'];
  // Every blocked probe timed out, and nothing shows the targets were up: not a pass.
  assert.equal(classify([{ probe: probe('10.1.50.10', 'blocked'), outcome: 'timeout' }]).verdict, 'INCONCLUSIVE');
  // The same timeout, with a positive control that reached the same host: proven.
  assert.equal(classify([
    { probe: probe('10.1.50.10', 'blocked'), outcome: 'timeout' },
    { probe: { ...probe('10.1.50.10', 'open'), port: 443 }, outcome: 'open' },
  ]).verdict, 'PASS');
  // A failure outranks everything else.
  assert.equal(classify([
    { probe: probe('10.1.50.10', 'blocked'), outcome: 'timeout' },
    { probe: probe('10.1.50.11', 'open'), outcome: 'timeout' },
  ]).verdict, 'FAIL');
});

test('the generated rules are verified as written, so a renderer bug is caught (DEL-06)', () => {
  const model = loadModel();
  const policy = compilePolicy(model);
  const rendered = renderAll(model, policy);
  const expectations = readYaml<Expectation[]>(join(REPO_ROOT, 'network', 'expectations.yaml'));
  const fails = (files: Map<string, string>) => checkGeneratedRules(model, policy, files, expectations).filter((r) => r.status === 'fail').map((r) => r.rule);
  assert.deepEqual(fails(rendered), []);
  const insert = (rule: string) => (t: string) => t.replace('    limit rate 10/second log prefix "natax-drop-in "', `    ${rule}\n    limit rate 10/second log prefix "natax-drop-in "`);
  const mutations: [string, string, (text: string) => string, string][] = [
    ['nftables/rejection-triage.nft', 'a declared path dropped', (t) => t.replace(/[^\n]*"Stores triage state\."\n/, ''), 'DEL-06'],
    ['nftables/app-db.nft', 'the database open to all of NATAX', insert('ip saddr 10.0.0.0/8 tcp dport 5432 accept'), 'DEL-06'],
    ['nftables/payments.nft', 'default allow', (t) => t.replace('hook input priority filter; policy drop;', 'hook input priority filter; policy accept;'), 'ZTN-03'],
    ['nftables/calc-engine.nft', 'SSH from anywhere', insert('tcp dport 22 accept'), 'IAM-06'],
    ['nftables/returns-service.nft', 'a statement nobody can verify', insert('meta l4proto tcp accept'), 'DEL-06'],
    ['nftables/payments.nft', 'UDP accepted, which no probe tests', insert('ip saddr 10.0.0.0/8 ip protocol udp accept'), 'DEL-06'],
    // Round 2's differentials: valid nftables the earlier reader skipped or misread, while the
    // kernel accepted the traffic. Each is refused by the grammar now.
    ['nftables/core-db.nft', 'every new connection accepted', insert('ct state new accept'), 'DEL-06'],
    ['nftables/core-db.nft', 'state list including new', insert('ct state established,related,new accept'), 'DEL-06'],
    ['nftables/app-db.nft', 'a port range', insert('ip saddr 10.0.0.0/8 tcp dport { 1-65535 } accept'), 'DEL-06'],
    ['nftables/app-db.nft', 'a named port', insert('ip saddr 10.0.0.0/8 tcp dport { postgresql } accept'), 'DEL-06'],
    ['nftables/app-db.nft', 'a port set', insert('ip saddr 10.0.0.0/8 tcp dport { 22, 5432 } accept'), 'DEL-06'],
    ['nftables/app-db.nft', 'a rule hidden after a comment marker', insert('ip saddr 10.0.0.0/8 tcp dport 5432 accept # harmless'), 'DEL-06'],
    ['nftables/app-db.nft', 'a second input chain', (t) => t.replace('  chain output {', '  chain input {\n    type filter hook input priority filter; policy accept;\n  }\n\n  chain output {'), 'DEL-06'],
    ['nftables/app-db.nft', 'an invalid address that matches nothing in the reader', insert('ip saddr 10.0.0.300 tcp dport 5432 accept'), 'DEL-06'],
    ['nftables/payments.nft', 'ICMP from anywhere', (t) => t.replace(/ip saddr \{[^}]*\} ip protocol icmp icmp type echo-request/, 'ip protocol icmp icmp type echo-request'), 'ZTN-03'],
    ['nftables/hq-router.nft', 'app-db replication can\'t transit HQ', (t) => t.replace(/[^\n]*ip saddr 10\.1\.30\.31 ip daddr 10\.2\.30\.31 tcp dport 5432 accept[^\n]*\n/, ''), 'RES-04'],
  ];
  for (const [file, name, mutate, rule] of mutations) {
    const files = new Map(rendered);
    const before = files.get(file)!;
    files.set(file, mutate(before));
    assert.notEqual(files.get(file), before, `the mutation "${name}" didn't apply`);
    assert.ok(fails(files).includes(rule), `not caught: ${name}`);
  }
});

test('"the internet" in the intent never includes NATAX hosts', () => {
  const model = loadModel();
  const policy = compilePolicy(model);
  // filing-web is published to the internet through the edge; rejection-triage isn't on the internet.
  assert.equal(isAllowed(policy, '10.1.20.31', '10.1.10.10', 443), undefined);
  assert.ok(isAllowed(policy, '198.51.100.10', '10.1.10.10', 443));
  // The egress proxy reaches the internet, not NATAX's own load balancers.
  assert.equal(isAllowed(policy, '10.1.50.30', '10.1.50.10', 443), undefined);
});

test('the egress allowlist is checked as the proxy reads it (INT-05, DEL-06)', () => {
  const model = loadModel();
  const rendered = renderAll(model, compilePolicy(model));
  const fails = (text: string) => checkEgressAllowlist(model, new Map([['egress-proxy/allowlist.yaml', text]])).filter((r) => r.status === 'fail').map((r) => r.message);
  const allowlist = rendered.get('egress-proxy/allowlist.yaml')!;
  assert.deepEqual(fails(allowlist), []);
  const mutations: [string, (t: string) => string, RegExp][] = [
    ['not valid YAML', (t) => t.replace('"login.workforce-idp.example:443"', '*.workforce-idp.example:443'), /valid YAML/],
    ['an undeclared destination', (t) => t.replace('"login.workforce-idp.example:443"', '"login.workforce-idp.example:443", "paste.example:443"'), /doesn't declare/],
    ['a wildcard without a reason', (t) => t.replace('"login.workforce-idp.example:443"', '"*.workforce-idp.example:443"'), /wildcard|doesn't declare/],
    ['a declared destination missing', (t) => t.replace(', "api.sms-provider.example:443"', ''), /can't reach its declared/],
    ['default allow', (t) => t.replace('default: deny', 'default: allow'), /default isn't deny/],
  ];
  for (const [name, mutate, expected] of mutations) {
    const changed = mutate(allowlist);
    assert.notEqual(changed, allowlist, `the mutation "${name}" didn't apply`);
    assert.ok(fails(changed).some((m) => expected.test(m)), `not caught: ${name}`);
  }
});

test('a blocked probe is conclusive with evidence from any vantage in the same window (ZTN-06)', () => {
  const probe = (from: string, to: string, expect: 'open' | 'blocked', port = 5432) => ({ from, fromLabel: from, to, toLabel: to, port, expect }) as Probe;
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 15, 10, minutes)).toISOString();
  // From rejection-triage, the replica can't be reached, and nothing from here shows it's up...
  const triage = { from: '10.1.20.31', started: at(0), finished: at(5), results: [{ probe: probe('10.1.20.31', '10.2.30.31', 'blocked'), outcome: 'timeout' as const }] };
  assert.equal(combine([triage]).verdict, 'INCONCLUSIVE');
  // ...but the load balancer reached it in the same window: the timeout is evidence of filtering.
  const lb = { from: '10.1.50.11', started: at(2), finished: at(6), results: [{ probe: probe('10.1.50.11', '10.2.30.31', 'open', 8008), outcome: 'open' as const }] };
  assert.equal(combine([triage, lb]).verdict, 'PASS');
  // Monitoring's own view counts too.
  assert.equal(combine([triage], ['10.2.30.31']).verdict, 'PASS');
  // Evidence from another day isn't evidence.
  assert.equal(combine([triage, { ...lb, started: at(0).replace('15T', '14T'), finished: at(1).replace('15T', '14T') }]).verdict, 'INCONCLUSIVE');
});

test('no zone reaches a service directly, the Power Platform\'s included (SEC-02, PA-09)', () => {
  const landscape = clone(loadLandscape());
  const db = landscape.services['core-db']!;
  db.provides = [...(db.provides ?? []), { name: 'direct', port: 5432, consumers: ['zone:power-platform'] }];
  const model = loadModel(undefined, landscape);
  const results = checkInvariants(model, compilePolicy(model));
  assert.ok(results.some((r) => r.status === 'fail' && r.rule === 'SEC-02' && /power-platform reaches core-db/.test(r.message)));
});

// Tests for the infrastructure checks and the failure simulation. Each test makes one
// realistic mistake in a copy of the landscape and checks that it is caught.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { REPO_ROOT, clone, loadLandscape, loadModel, withApplications } from '../../enterprise-architecture/tools/lib/load.ts';
const FIXTURE = join(REPO_ROOT, 'enterprise-architecture', 'tools', 'fixtures', 'registered-app');
import type { Landscape, Model } from '../../enterprise-architecture/tools/lib/model.ts';
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

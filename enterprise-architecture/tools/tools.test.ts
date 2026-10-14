// Tests for the central tools: manifest validation, dependency and secret checks, links.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anchor, checkLinks } from './check-links.ts';
import { stringify } from 'yaml';
import { checkDependencies, sectionMentions } from './check-dependencies.ts';
import { REPO_ROOT, clone, loadManifest } from './lib/load.ts';
import { scanSecrets } from './scan-secrets.ts';
import { validateManifest } from './validate-manifest.ts';

const APP = join(REPO_ROOT, 'enterprise-architecture', 'tools', 'fixtures', 'registered-app');
const failures = (results: { status: string; rule: string }[]) => results.filter((r) => r.status === 'fail').map((r) => r.rule);

test('a registered application passes manifest validation', () => {
  assert.deepEqual(failures(validateManifest(APP, loadManifest(APP))), []);
});

test('a Problem Owner who has left fails OWN-01', () => {
  const m = clone(loadManifest(APP));
  m['problem-owner'] = 'aquinn';
  assert.ok(failures(validateManifest(APP, m)).includes('OWN-01'));
});

test('class A without a Technical Owner fails OWN-03', () => {
  const m = clone(loadManifest(APP));
  m.resilience.class = 'A';
  assert.ok(failures(validateManifest(APP, m)).includes('OWN-03'));
});

test('taxpayer-restricted data on app-db fails DAT-01', () => {
  const m = clone(loadManifest(APP));
  m.data![0]!.classification = 'taxpayer-restricted';
  m['technical-owner'] = 'some-team';
  assert.ok(failures(validateManifest(APP, m)).includes('DAT-01'));
});

test('a new consumer of the contained integration broker fails INT-02', () => {
  const m = clone(loadManifest(APP));
  m.consumes!.push({ service: 'integration-broker', interface: 'amqps', purpose: 'Convenient' });
  assert.ok(failures(validateManifest(APP, m)).includes('INT-02'));
});

test('emailing customers directly fails INT-05', () => {
  const m = clone(loadManifest(APP));
  m.consumes!.push({ external: 'email-provider', purpose: 'Email customers' });
  assert.ok(failures(validateManifest(APP, m)).includes('INT-05'));
});

test('an unknown or withdrawn architecture version fails OWN-04', () => {
  const m = clone(loadManifest(APP));
  m.architecture['enterprise-architecture'] = '0.9.0';
  assert.ok(failures(validateManifest(APP, m)).includes('OWN-04'));
});

test('a proposed architecture version cannot be pinned yet', () => {
  const m = clone(loadManifest(APP));
  m.architecture['enterprise-architecture'] = '1.1.0';
  assert.ok(failures(validateManifest(APP, m)).includes('OWN-04'));
});

test('temporary complexity past its end date fails SIM-07', () => {
  const m = clone(loadManifest(APP));
  m.temporary = [{ what: 'Old queue view', owner: 'dwhitfield', 'remove-by': '2026-01-31' }];
  assert.ok(failures(validateManifest(APP, m)).includes('SIM-07'));
});

test('a class B service in one datacenter fails RES-02', () => {
  const m = clone(loadManifest(APP));
  m.runtime.sites = ['dc1'];
  assert.ok(failures(validateManifest(APP, m)).includes('RES-02'));
});

test('an application without a recorded landscape check fails SIM-09', () => {
  const m = clone(loadManifest(APP));
  delete m['landscape-check'];
  assert.ok(failures(validateManifest(APP, m)).includes('SIM-09'));
});

test('a landscape check that is still the template fails SIM-09, on every platform', () => {
  for (const platform of ['typescript-web', 'power-apps', 'android']) {
    const template = join(REPO_ROOT, 'platforms', platform, 'template');
    const results = validateManifest(template, loadManifest(template));
    assert.ok(results.some((r) => r.rule === 'SIM-09' && r.status === 'fail' && /still the template/.test(r.message)), platform);
  }
});

test('staff APIs at the edge need a Technical Owner (OWN-03) and the workforce IdP (IAM-01)', () => {
  const m = clone(loadManifest(APP));
  m.exposure = 'staff-edge';
  assert.ok(failures(validateManifest(APP, m)).includes('OWN-03'));
  m['technical-owner'] = 'filing-platform-team';
  assert.ok(!failures(validateManifest(APP, m)).includes('OWN-03'));
  assert.ok(!failures(validateManifest(APP, m)).includes('IAM-01'));
  m.users['identity-provider'] = 'customer';
  assert.ok(failures(validateManifest(APP, m)).includes('IAM-01'));
});

test('staff never sign in to internet-exposed applications (IAM-01)', () => {
  const m = clone(loadManifest(APP));
  m.exposure = 'internet';
  m['technical-owner'] = 'filing-platform-team';
  assert.ok(failures(validateManifest(APP, m)).includes('IAM-01'));
});

test('a Power App cannot be class A, hold taxpayer-restricted data or face customers (platform limits)', () => {
  const m = clone(loadManifest(APP));
  m.runtime.technology = 'power-apps';
  m.architecture = { 'enterprise-architecture': '1.0.0', 'power-apps': '1.0.0', network: '1.0.0', infrastructure: '1.0.0' };
  m.data = [{ store: 'dataverse', database: 'Cases', classification: 'confidential', retention: 'P1Y' }];
  assert.ok(!failures(validateManifest(APP, m)).includes('PLATFORM'), 'class B, confidential, internal fits');
  for (const change of [
    (x: typeof m) => { x.resilience.class = 'A'; },
    (x: typeof m) => { x.data![0]!.classification = 'taxpayer-restricted'; },
    (x: typeof m) => { x.exposure = 'internet'; },
  ]) {
    const bad = clone(m);
    change(bad);
    assert.ok(failures(validateManifest(APP, bad)).includes('PLATFORM'));
  }
});

test('a Power App keeps its data in Dataverse or SharePoint, not a PostgreSQL cluster (DAT-06)', () => {
  const m = clone(loadManifest(APP));
  m.runtime.technology = 'power-apps';
  m.architecture = { 'enterprise-architecture': '1.0.0', 'power-apps': '1.0.0', network: '1.0.0', infrastructure: '1.0.0' };
  assert.ok(failures(validateManifest(APP, m)).includes('DAT-06'));
});

test('a Power App may use only connectors the DLP policy approves (PA-08)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pa-'));
  const m = clone(loadManifest(APP));
  m.runtime.technology = 'power-apps';
  m.runtime.connectors = ['SharePoint', 'HTTP'];
  writeFileSync(join(dir, 'architecture.yaml'), stringify(m));
  const results = checkDependencies(dir);
  assert.ok(results.some((r) => r.status === 'pass' && r.message.startsWith('SharePoint')));
  assert.ok(results.some((r) => r.status === 'fail' && /HTTP is blocked/.test(r.message)));
});

test('a misspelled classification never passes the platform limits', () => {
  const m = clone(loadManifest(APP));
  (m.data![0] as { classification: string }).classification = 'confidental';
  assert.ok(failures(validateManifest(APP, m)).includes('PLATFORM'));
});

test('an unknown platform is refused', () => {
  const m = clone(loadManifest(APP));
  m.runtime.technology = 'low-code-of-the-month';
  assert.ok(failures(validateManifest(APP, m)).includes('PLATFORM'));
});

test('dependency reasons are found only in the Dependencies section, by exact name', () => {
  const record = '# 0007\n\n## Context\nWe considered express.\n\n## Dependencies\n\n- `zod`: validation\n';
  assert.equal(sectionMentions(record, 'Dependencies', 'zod'), true);
  assert.equal(sectionMentions(record, 'Dependencies', 'express'), false);
  assert.equal(sectionMentions(record, 'Dependencies', 'zo'), false);
});

test('the secret scanner finds keys and credentials, but not local development URLs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'ok.ts'), "const url = 'postgres://app:app@localhost:5432/dev';\n");
  assert.deepEqual(failures(scanSecrets(dir)), []);
  writeFileSync(join(dir, 'src', 'bad.ts'), "const db = 'postgres://app:hunter22@db.natax.internal/prod';\nconst apiKey = 'sk_live_51HxQ2aBcDeFgHiJ';\n"); // secret-scan: allow
  assert.equal(failures(scanSecrets(dir)).length, 2);
});

test('anchors follow the rule heading convention', () => {
  assert.equal(anchor("SEC-07: Test environments can't reach production"), 'sec-07-test-environments-cant-reach-production');
});

test('every relative link and anchor in the repository resolves', () => {
  assert.deepEqual(checkLinks().filter((r) => r.status === 'fail').map((r) => r.message), []);
});

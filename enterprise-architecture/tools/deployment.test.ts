// Tests for what a deployment may do (DEL-08), its plan and rollbacks (DEL-09, DEL-03, DAT-07,
// AND-13), and the Board's per-subject files (SIM-07, OWN-10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { checkDeployment, checkGovernanceFiles, unitProblems } from './check-deployment.ts';
import { REPO_ROOT, loadExceptions } from './lib/load.ts';
import type { DeploymentPlan, Grant, Manifest } from './lib/model.ts';
import { sharedSystemExceptions } from './pipeline.ts';

const write = (file: string, text: string) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };

/** An architecture with the real pre-approved actions and platforms, and these grants for "app". */
function architecture(grants: Partial<Grant>[]): string {
  const root = mkdtempSync(join(tmpdir(), 'arch-'));
  write(join(root, 'enterprise-architecture', 'pipeline', 'deployment-actions.yaml'), '');
  copyFileSync(join(REPO_ROOT, 'enterprise-architecture', 'pipeline', 'deployment-actions.yaml'), join(root, 'enterprise-architecture', 'pipeline', 'deployment-actions.yaml'));
  for (const p of ['typescript-web', 'android']) {
    write(join(root, 'platforms', p, 'platform.yaml'), '');
    copyFileSync(join(REPO_ROOT, 'platforms', p, 'platform.yaml'), join(root, 'platforms', p, 'platform.yaml'));
  }
  write(join(root, 'enterprise-architecture', 'governance', 'deployment-grants', 'app.yaml'), stringify({ grants }));
  return root;
}

const granted = (action: string, target: string, extra: Partial<Grant> = {}): Partial<Grant> =>
  ({ id: `DG-${action}-${target}`, action, target, 'approved-by': ['board'], granted: '2026-10-27', reason: 'Test.', ...extra });

const GRANTS = [granted('vm-release', 'app'), granted('backup', 'appdb'), granted('migrations', 'appdb'), granted('restore', 'appdb'), granted('systemd-unit', 'app-worker')];
const manifest = (cls: string, technology = 'typescript-web') => ({ application: 'app', resilience: { class: cls }, runtime: { technology } }) as unknown as Manifest;

/** An application repository with a candidate whose plan is the given one. */
function candidate(plan: unknown, files: Record<string, string> = {}): { appDir: string; candidateDir: string } {
  const appDir = mkdtempSync(join(tmpdir(), 'app-'));
  const all = {
    'db/0042-slots.sql': 'create table slots (id int);',
    'db/0042-slots.down.sql': 'drop table slots;',
    'deploy/app-worker.service': '[Service]\nUser=app\nExecStart=/usr/bin/node worker.js\n',
    ...files,
  };
  for (const [f, text] of Object.entries(all)) write(join(appDir, f), text);
  const candidateDir = join(appDir, 'releases', 'rc-1');
  write(join(candidateDir, 'candidate.yaml'), stringify({ id: 'rc-1', application: 'app' }));
  if (plan !== undefined) write(join(candidateDir, 'deployment-plan.yaml'), stringify(plan));
  return { appDir, candidateDir };
}

// A class C service: it may stop for a step.
const GOOD: DeploymentPlan = {
  steps: [
    { id: 'backup', action: 'backup', target: 'appdb', application: 'keeps-running' },
    { id: 'migrate', action: 'migrations', target: 'appdb', application: 'must-stop', files: ['db/0042-slots.sql'] },
    { id: 'worker', action: 'systemd-unit', target: 'app-worker', application: 'must-stop', file: 'deploy/app-worker.service' },
    { id: 'release', action: 'vm-release', target: 'app', application: 'must-stop' },
  ],
  rollbacks: [
    { covers: ['migrate', 'release'], steps: [
      { action: 'vm-release', target: 'app', application: 'must-stop' },
      { action: 'migrations', target: 'appdb', application: 'must-stop', files: ['db/0042-slots.down.sql'] },
    ] },
    { covers: ['worker'], steps: [{ action: 'systemd-unit', target: 'app-worker', application: 'must-stop' }] },
  ],
};

const clone = <T>(x: T): T => structuredClone(x);
function judge(plan: unknown, options: { grants?: Partial<Grant>[]; files?: Record<string, string>; cls?: string; technology?: string } = {}) {
  const { appDir, candidateDir } = candidate(plan, options.files);
  return checkDeployment(appDir, manifest(options.cls ?? 'C', options.technology), candidateDir, architecture(options.grants ?? GRANTS));
}
const failing = <T extends { status: string }>(results: T[]) => results.filter((r) => r.status === 'fail');
const rules = (results: { status: string; rule: string }[]) => [...new Set(failing(results).map((r) => r.rule))].sort();

test('a granted plan, with a rollback that undoes every step, passes (DEL-08, DEL-09)', () => {
  assert.deepEqual(failing(judge(GOOD)), []);
});

test('no plan, no deployment; and without a candidate the check doesn\'t run (DEL-09)', () => {
  assert.deepEqual(rules(judge(undefined)), ['DEL-09']);
  assert.deepEqual(checkDeployment('.', manifest('C'), undefined).map((r) => r.status), ['skip'], 'a local run is incomplete, not failed');
});

test('nothing is granted by default, and shared systems and host packages aren\'t actions (DEL-08, OWN-10, INF-11)', () => {
  assert.deepEqual(rules(judge(GOOD, { grants: [] })), ['DEL-08'], 'no grants: every step is refused');
  const plan = clone(GOOD);
  plan.steps.push({ id: 'open', action: 'firewall-rule', target: 'tcp/8445', application: 'keeps-running' });
  plan.steps.push({ id: 'lb', action: 'haproxy-backend', target: 'app', application: 'keeps-running' });
  plan.steps.push({ id: 'tool', action: 'dnf-package', target: 'ImageMagick', application: 'keeps-running' });
  assert.deepEqual(rules(judge(plan)), ['INF-11', 'OWN-10']);
  const other = clone(GOOD);
  other.steps[3]!.target = 'other-service';
  assert.ok(failing(judge(other)).some((r) => r.rule === 'DEL-08' && /vm-release on other-service isn't granted/.test(r.message)), 'a grant is for one named target');
  assert.ok(failing(judge(GOOD, { technology: 'android', grants: GRANTS })).some((r) => /not for this platform \(devices\)/.test(r.message)), 'actions are per platform');
});

test('a class A or B service in the datacenters never stops (DEL-09)', () => {
  assert.ok(failing(judge(GOOD, { cls: 'B' })).some((r) => /would stop a class B service/.test(r.message)));
  const rolling = clone(GOOD);
  for (const s of [...rolling.steps, ...rolling.rollbacks.flatMap((r) => r.steps)]) s.application = 'keeps-running';
  const { appDir, candidateDir } = candidate(rolling, { 'docs/previous.txt': 'ok 1\n' });
  write(join(candidateDir, 'candidate.yaml'), stringify({ id: 'rc-1', application: 'app', evidence: { 'previous-release-tests': 'docs/previous.txt' } }));
  assert.deepEqual(failing(checkDeployment(appDir, manifest('A'), candidateDir, architecture(GRANTS))), []);
});

test('every step that changes production is covered by exactly one rollback that undoes it (DEL-09)', () => {
  const uncovered = clone(GOOD);
  uncovered.rollbacks[0]!.covers = ['release'];
  assert.ok(failing(judge(uncovered)).some((r) => /migrate .* covered by 0 rollbacks/.test(r.message)));
  const twice = clone(GOOD);
  twice.rollbacks.push({ covers: ['release'], steps: [{ action: 'vm-release', target: 'app', application: 'must-stop' }] });
  assert.ok(failing(judge(twice)).some((r) => /release .* covered by 2 rollbacks/.test(r.message)));
  const wrong = clone(GOOD);
  wrong.rollbacks[0]!.steps = wrong.rollbacks[0]!.steps.filter((s) => s.action !== 'vm-release');
  assert.ok(failing(judge(wrong)).some((r) => /nothing in it undoes it/.test(r.message)));
  const silent = clone(GOOD);
  delete (silent.steps[1] as Partial<typeof silent.steps[1]>).application;
  assert.ok(failing(judge(silent)).some((r) => /must stop for it/.test(r.message)), 'every step says whether the application must stop');
});

test('a migration has its way back: its down migration, or a restore of an earlier backup (DAT-07)', () => {
  const noDown = clone(GOOD);
  noDown.rollbacks[0]!.steps[1]!.files = [];
  assert.ok(failing(judge(noDown)).some((r) => r.rule === 'DAT-07' && /0042-slots\.down\.sql/.test(r.message)));
  const restored = clone(GOOD);
  restored.rollbacks[0]!.steps[1] = { action: 'restore', target: 'appdb', application: 'must-stop', from: 'backup' };
  assert.deepEqual(failing(judge(restored)), [], 'restoring the backup the plan made first');
  const late = clone(restored);
  late.steps = [late.steps[1]!, late.steps[0]!, late.steps[2]!, late.steps[3]!];
  assert.ok(failing(judge(late)).some((r) => /isn't a backup of appdb earlier in the plan/.test(r.message)));
  const running = clone(GOOD);
  running.steps[1]!.application = 'keeps-running';
  assert.ok(failing(judge(running)).some((r) => r.rule === 'DAT-07' && /keeps running/.test(r.message)), 'the previous release\'s tests are the proof');
});

test('an Android release is undone only by its three steps, together and in order (AND-13)', () => {
  const grants = ['store-release', 'halt-rollout', 'refuse-version', 'reinstall-previous'].map((a) => granted(a, 'app'));
  const three = [
    { action: 'halt-rollout', target: 'app', application: 'keeps-running' as const },
    { action: 'refuse-version', target: 'app', application: 'keeps-running' as const },
    { action: 'reinstall-previous', target: 'app', application: 'keeps-running' as const },
  ];
  const plan = (steps: typeof three): DeploymentPlan => ({ steps: [{ id: 'store', action: 'store-release', target: 'app', application: 'keeps-running' }], rollbacks: [{ covers: ['store'], steps }] });
  const android = (p: DeploymentPlan) => judge(p, { technology: 'android', grants, cls: 'B' });
  assert.deepEqual(failing(android(plan(three))), []);
  assert.ok(failing(android(plan([three[0]!]))).some((r) => /halt-rollout then refuse-version then reinstall-previous/.test(r.message)), 'halting alone leaves the updated devices on the version');
  assert.ok(failing(android(plan([three[2]!, three[0]!, three[1]!]))).some((r) => /nothing in it undoes it/.test(r.message)), 'reinstalling before the outbox is sent loses work');
});

test('a unit runs as its own user, without privileges (SEC-09)', () => {
  assert.deepEqual(unitProblems('[Service]\nUser=app\nExecStart=/usr/bin/node a.js\n'), []);
  assert.equal(unitProblems('[Service]\nExecStartPre=+/srv/prepare.sh\nAmbientCapabilities=CAP_NET_ADMIN\nNoNewPrivileges=no\n').length, 4);
  assert.ok(failing(judge(GOOD, { files: { 'deploy/app-worker.service': '[Service]\nUser=root\n' } })).some((r) => r.rule === 'SEC-09'));
});

test('the Board\'s files are each for something in the landscape, and every grant is approved and explained (SIM-07, DEL-08, OWN-10)', () => {
  const root = architecture([]);
  write(join(root, 'enterprise-architecture', 'landscape', 'landscape.yaml'), stringify({
    sites: { dc1: {} }, services: { app: { kind: 'application' } },
    'shared-systems': { network: { steward: 'network-agent', covers: 'The firewalls.', source: 'The network repository.' } },
  }));
  const grants = (list: Partial<Grant>[]) => write(join(root, 'enterprise-architecture', 'governance', 'deployment-grants', 'app.yaml'), stringify({ grants: list }));
  const problems = () => failing(checkGovernanceFiles(root)).map((r) => r.message).join('\n');
  grants([granted('vm-release', 'app'), granted('migrations', 'appdb', { 'approved-by': ['network-agent', 'governance-agent'] })]);
  assert.equal(problems(), '');
  grants([granted('vm-release', 'app', { reason: '' })]);
  assert.match(problems(), /no reason: no decision without intent/);
  grants([granted('vm-release', 'app', { 'approved-by': ['network-agent'] })]);
  assert.match(problems(), /isn't approved by the Architecture Board, nor by a steward together with the Governance Agent/, 'a steward never approves alone');
  grants([granted('vm-release', 'app', { 'approved-by': ['db-steward', 'governance-agent'] })]);
  assert.match(problems(), /isn't approved/, 'a steward the landscape doesn\'t name is nobody');
  grants([granted('run-script', 'app')]);
  assert.match(problems(), /isn't a pre-approved action/);
  grants([]);
  write(join(root, 'enterprise-architecture', 'governance', 'exceptions', 'network.yaml'), 'exceptions: []\n');
  assert.equal(problems(), '', 'a shared system is a subject too');
  write(join(root, 'enterprise-architecture', 'governance', 'exceptions', 'nonesuch.yaml'), 'exceptions: []\n');
  assert.match(problems(), /nonesuch.*isn't an application, shared system or site/);
});

test('exceptions are one file per subject; the network\'s is shown on every candidate (SIM-07, ZTN-10)', () => {
  assert.deepEqual(loadExceptions().map((e) => `${e.application}:${e.id}`).sort(), ['data-warehouse:EXC-2026-003', 'network:EXC-2026-004']);
  const shown = sharedSystemExceptions(new Date('2026-11-01'));
  assert.ok(shown.some((r) => r.status === 'warn' && r.rule === 'ZTN-10' && /EXC-2026-004/.test(r.message)));
  assert.ok(sharedSystemExceptions(new Date('2027-11-01')).some((r) => r.status === 'fail' && /expired/.test(r.message)), 'an expired exception is a failure, not a silence');
});

test('this architecture\'s own exception and grant files are valid (SIM-07, DEL-08)', () => {
  assert.deepEqual(failing(checkGovernanceFiles()), []);
});

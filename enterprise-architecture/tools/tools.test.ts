// Tests for the central tools: manifest validation, dependency and secret checks, links.

// The authorities (real nftables, HAProxy) have their own tests: npm run test:authority.
process.env.NATAX_AUTHORITIES = 'off';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { anchor, checkLinks } from './check-links.ts';
import { stringify } from 'yaml';
import { checkDependencies, sectionMentions } from './check-dependencies.ts';
import { REPO_ROOT, clone, intentChanges, loadExceptions, loadManifest, loadModel, withApplications } from './lib/load.ts';
import { fail, pass } from './lib/report.ts';
import { verifyNetwork } from '../../network/tools/verify.ts';
import { verifyInfrastructure } from '../../infrastructure/tools/verify.ts';
import { scanSecrets } from './scan-secrets.ts';
import { validateManifest } from './validate-manifest.ts';
import { checkApprovedArchitecture, checkPinnedVersions, runPipeline } from './pipeline.ts';
import { EXPECTED, verifyRunner } from './verify-runner.ts';
import { judgeGateChanges } from './verify-gate-inputs.ts';
import { applyExceptions, exceptionProblems } from './lib/exceptions.ts';

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
  m.provides![0]!.via = 'edge-adc';   // what makes it staff-edge: published at the edge, not to the internet zone
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

test('the secret scanner finds every planted secret, and can\'t be silenced from inside the repository', () => {
  // Built at runtime, so no file in this repository contains a real-looking secret.
  const r = (n: number, chars = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7') => Array.from({ length: n }, (_, i) => chars[(i * 7) % chars.length]).join('');
  const planted: [string, string][] = [
    ['src/key.pem', `-----BEGIN ${'RSA PRIVATE'} KEY-----`],
    ['src/aws.ts', `const id = '${'AKIA'}${r(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')}';`],
    ['src/gh.ts', `const t = '${'ghp_'}${r(36)}';`],
    ['src/gl.ts', `const t = '${'glpat-'}${r(20)}';`],
    ['src/slack.ts', `const hook = '${'xoxb-'}${r(24)}';`],
    ['src/stripe.ts', `const k = '${'sk_live_'}${r(24)}';`],
    ['src/google.ts', `const k = '${'AIza'}${r(35)}';`],
    ['src/sendgrid.ts', `const k = '${'SG.'}${r(22)}.${r(43)}';`],
    ['.npmrc', `//registry.npmjs.org/:_authToken=${'npm_'}${r(36)}`],
    ['src/azure.ts', `const c = 'DefaultEndpointsProtocol=https;AccountName=x;${'AccountKey='}${r(86)}==';`],
    ['src/sas.ts', `const u = 'https://x.blob.core.windows.net/c?sv=2024&${'sig='}${r(44)}';`],
    ['src/jwt.ts', `const t = '${'eyJ'}${r(20)}.${'eyJ'}${r(30)}.${r(43)}';`],
    ['src/config.ts', `const settings = { clientSecret: '${r(24)}' };`],
    ['.env.production', `DB_PASSWORD=${r(16)}`],
    ['src/db.ts', `const url = 'postgres://app:${r(12)}@db.natax.internal/prod';`],
  ];
  const dir = mkdtempSync(join(tmpdir(), 'scan-'));
  mkdirSync(join(dir, 'src'));
  // Not secrets: local development defaults, references, placeholders, code.
  writeFileSync(join(dir, 'src', 'ok.ts'), [
    "const url = 'postgres://app:app@localhost:5432/dev';",
    'const password = process.env.DB_PASSWORD;',
    "const token = '${TOKEN}';",
    'const clientSecret = secretFile(env.OIDC_CLIENT_SECRET_FILE);',
  ].join('\n'));
  assert.deepEqual(failures(scanSecrets(dir)), []);
  for (const [file, line] of planted) writeFileSync(join(dir, file), `${line} // secret-scan: allow\n`);
  const found = scanSecrets(dir).filter((x) => x.status === 'fail').map((x) => x.message);
  for (const [file] of planted) assert.ok(found.some((m) => m.includes(join(file))), `not found: ${file}`);
  // A false positive is allowed centrally, by fingerprint, never by a comment in the repository.
  const print = /fingerprint (\w+)/.exec(found[0]!)![1]!;
  const allowlist = join(dir, '..', `allow-${print}.yaml`);
  writeFileSync(allowlist, stringify({ allowed: [{ fingerprint: print, reason: 'test', 'approved-by': 'jalvarez' }] }));
  assert.equal(scanSecrets(dir, allowlist).filter((x) => x.status === 'fail').length, planted.length - 1);
});

test('anchors follow the rule heading convention', () => {
  assert.equal(anchor("SEC-07: Test environments can't reach production"), 'sec-07-test-environments-cant-reach-production');
});

test('every relative link and anchor in the repository resolves', () => {
  assert.deepEqual(checkLinks().filter((r) => r.status === 'fail').map((r) => r.message), []);
});

test('a change to a registered application is checked exactly like a new application', () => {
  // A candidate for rejection-triage that reaches into payments and the taxpayer database, faces the
  // internet, drops a resilience class and claims 4,000 vCPU. Under its real name it must fail the
  // same checks as under a name the landscape has never seen.
  const failuresFor = (name: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'changed-'));
    const m = clone(loadManifest(APP));
    m.application = name;
    m.exposure = 'internet';
    m.resilience.class = 'C';
    m.runtime['peak-vcpu'] = 4000;
    m.consumes = [...(m.consumes ?? []),
      { service: 'payments', interface: 'api', purpose: 'Refund status.' },
      { service: 'core-db', interface: 'postgres', database: 'returns', purpose: 'Return details.' }];
    writeFileSync(join(dir, 'architecture.yaml'), stringify(m));
    const rules = [...verifyNetwork(withApplications(loadModel(), [dir]), { drift: false }), ...verifyInfrastructure(withApplications(loadModel(), [dir]), { drift: false })]
      .filter((r) => r.status === 'fail').map((r) => r.rule);
    return [...new Set(rules)].sort();
  };
  const registered = failuresFor('rejection-triage');
  assert.ok(registered.length >= 2, `only ${registered.join(', ')}`);
  assert.deepEqual(registered, failuresFor('rejection-triage-copy'));
});

test('the pipeline lists what a candidate changes against production', () => {
  const production = loadModel().services.get('rejection-triage')!;
  const changed = clone(production);
  changed.class = 'C';
  changed.consumes = [...(changed.consumes ?? []), { service: 'payments', interface: 'api', purpose: 'x' }];
  const changes = intentChanges(production, changed);
  assert.ok(changes.some((c) => c.includes('class B -> C')));
  assert.ok(changes.some((c) => c.includes('payments')));
  assert.deepEqual(intentChanges(production, production), []);
});

test('the pipeline never runs candidate code outside an isolated runner, and says it is incomplete (SEC-13)', () => {
  const { sections, status } = runPipeline(APP, { today: new Date('2026-10-14') });
  const app = sections.find(([title]) => title.startsWith('Application'))![1];
  assert.equal(status, 'INCOMPLETE');
  assert.ok(app.length > 0 && app.every((r) => r.status === 'skip' && r.rule === 'SEC-13'));
});

// The pipeline's own preflight runs the real canary; these tests stand in for it, so the test suite
// never probes the network or writes outside its workspace on a developer's machine.
const isolatedRunner = () => [pass('SEC-13', 'stand-in: every escape attempt failed')];

test('a mandatory check that can\'t run makes the stage incomplete, not a pass', () => {
  // With --isolated, but no installed dependencies or tools here: the fixture has no lockfile to install from.
  const { status } = runPipeline(APP, { today: new Date('2026-10-14'), isolated: true, preflight: isolatedRunner });
  assert.notEqual(status, 'PASS');
});

test('--isolated is checked, not believed: when the canary escapes, the candidate\'s code never runs (SEC-13)', () => {
  const escaped = () => [fail('SEC-13', 'Run preflight: escaped. Expected: the internet is unreachable.')];
  const { sections, status } = runPipeline(APP, { today: new Date('2026-10-14'), isolated: true, preflight: escaped });
  const app = sections.find(([title]) => title.startsWith('Application'))![1];
  assert.equal(status, 'FAIL');
  assert.deepEqual(app.map((r) => r.rule), ['SEC-13']);
  assert.match(app[0]!.message, /didn't run/);
});

test('every command fails its own process when it finds a problem: automation reads exit codes', () => {
  const tools = join(REPO_ROOT, 'enterprise-architecture', 'tools');
  const exit = (args: string[]) => spawnSync(process.execPath, args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000 }).status;
  // A canary that "escapes", and one that doesn't, so the runner check is tested without touching the machine.
  const canary = (escapes: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'canary-'));
    writeFileSync(join(dir, 'escape.canary.ts'), `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest('the internet is unreachable', () => { assert.equal(${escapes}, false, 'reached 1.1.1.1:443'); });\n`);
    return dir;
  };
  const expect = ['--expect', 'the internet is unreachable'];
  assert.equal(exit([join(tools, 'verify-runner.ts'), '--canary', canary(true), ...expect]), 1, 'verify-runner, not isolated');
  assert.equal(exit([join(tools, 'verify-runner.ts'), '--canary', canary(false), ...expect]), 0, 'verify-runner, isolated');
  const bad = mkdtempSync(join(tmpdir(), 'bad-'));
  const m = clone(loadManifest(APP));
  m['problem-owner'] = 'aquinn';
  writeFileSync(join(bad, 'architecture.yaml'), stringify(m));
  writeFileSync(join(bad, 'package.json'), JSON.stringify({ dependencies: { pg: '8.23.1 || *' } }));
  writeFileSync(join(bad, 'config.ts'), `export const key = '${'AKIA'}IOSFODNN7EXAMPLE';\n`);
  assert.equal(exit([join(tools, 'validate-manifest.ts'), bad]), 1, 'validate-manifest');
  assert.equal(exit([join(tools, 'check-dependencies.ts'), bad]), 1, 'check-dependencies');
  assert.equal(exit([join(tools, 'scan-secrets.ts'), bad]), 1, 'scan-secrets');
  assert.equal(exit([join(tools, 'pipeline.ts'), APP]), 3, 'pipeline, incomplete');
  assert.equal(exit([join(REPO_ROOT, 'network', 'tools', 'probe.ts')]), 2, 'probe, no vantage point');
});

test('Board exceptions are validated before they cover anything, and cover only their own rules', () => {
  const today = new Date('2026-10-15');
  const real = loadExceptions().find((e) => e.id === 'EXC-2026-003')!;
  assert.deepEqual(exceptionProblems(real, today), []);
  const broken: [string, Partial<typeof real>][] = [
    ['more than 12 months', { granted: '2026-07-01', expires: '2028-01-01' }],
    ['a rule that doesn\'t exist', { rules: ['DAT-99'] }],
    ['an owner who left', { owner: 'aquinn' }],
    ['expired', { granted: '2025-01-01', expires: '2025-12-31' }],
    ['no compensating controls', { 'compensating-controls': ' ' }],
  ];
  for (const [name, change] of broken) assert.ok(exceptionProblems({ ...real, ...change }, today).length > 0, `accepted: ${name}`);
  const applied = applyExceptions([fail('DAT-02', 'Taxpayer identifiers in the warehouse.'), fail('DAT-02', 'Full names copied to a spreadsheet.'), fail('DAT-01', 'No classification.')], [real]);
  // Only the one finding it was granted for; another finding of the same rule still fails.
  assert.deepEqual(applied.map((r) => [r.rule, r.status]), [['DAT-02', 'warn'], ['DAT-02', 'fail'], ['DAT-01', 'fail']]);
  assert.ok(exceptionProblems({ ...real, finding: '' }, today).length > 0, 'accepted: an exception for a whole rule');
  assert.match(applied[0]!.message, /EXC-2026-003/);
  // Every exception the Board has granted is valid today.
  for (const e of loadExceptions()) assert.deepEqual(exceptionProblems(e, today), [], e.id);
});

test('a candidate is judged against the versions it pins, or the stage says it can\'t (OWN-04)', () => {
  assert.deepEqual(checkPinnedVersions({ 'enterprise-architecture': '1.0.0' }).map((r) => r.status), ['pass']);
  assert.deepEqual(checkPinnedVersions({ 'enterprise-architecture': '2.0.0' }).map((r) => r.status), ['skip']);
  assert.deepEqual(checkPinnedVersions({ 'no-such-architecture': '1.0.0' }).map((r) => r.status), ['skip']);
});

test('a canary run counts only when it finished and completed every attempt (SEC-13)', () => {
  const canary = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'canary-'));
    writeFileSync(join(dir, 'escape.canary.ts'), `import { test } from 'node:test';\n${body}\n`);
    return dir;
  };
  const counts = (dir: string) => !verifyRunner({ canary: dir, expected: ['one', 'two'] }).some((r) => r.status === 'fail');
  assert.equal(counts(canary(`test('one', () => {});\ntest('two', () => {});`)), true);
  // "ok 1", then the process dies before the rest of the attempts run.
  assert.equal(counts(canary(`test('one', () => {});\ntest('two', () => { process.exit(0); });`)), false);
  // An attempt that was skipped verified nothing.
  assert.equal(counts(canary(`test('one', () => {});\ntest('two', { skip: true }, () => {});`)), false);
  // The real canary must run every attempt of its phase.
  assert.deepEqual(EXPECTED.preflight.slice(0, 5), EXPECTED.escape);
});

test('only an approved, unchanged architecture can judge a candidate (AGT-04)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arch-'));
  const git = (...args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 'test@natax.example'); git('config', 'user.name', 'Test');
  mkdirSync(join(dir, 'network'));
  writeFileSync(join(dir, 'network', 'VERSION'), '1.0.0\n');
  writeFileSync(join(dir, 'network', 'standards.md'), '### ZTN-01: Rule\n');
  git('add', '-A'); git('commit', '-qm', 'v1'); git('tag', 'network/v1.0.0');
  const status = () => checkApprovedArchitecture(['network'], dir).map((r) => r.status);
  assert.deepEqual(status(), ['pass']);
  // Edited and not committed: what the Board approved isn't what would judge.
  writeFileSync(join(dir, 'network', 'standards.md'), '### ZTN-01: A weaker rule\n');
  assert.deepEqual(status(), ['skip']);
  // Committed, but not as a new approved version.
  git('commit', '-qam', 'weaker'); assert.deepEqual(status(), ['skip']);
  // A planted file nothing tracks.
  git('reset', '-q', '--hard', 'network/v1.0.0');
  writeFileSync(join(dir, 'network', 'extra-rules.md'), '### ZTN-99: Planted\n');
  assert.deepEqual(status(), ['skip']);
});

test('a test command that runs no tests fails, and the freeze uses production\'s class (DEL-02, DEL-05)', () => {
  // The registered fixture is class B in production; declaring class C mustn't escape the freeze.
  const dir = mkdtempSync(join(tmpdir(), 'freeze-'));
  const m = clone(loadManifest(APP));
  m.resilience.class = 'C';
  writeFileSync(join(dir, 'architecture.yaml'), stringify(m));
  const { sections } = runPipeline(dir, { today: new Date('2027-04-20'), candidateDir: undefined });
  const intake = sections[0]![1];
  assert.ok(intake.some((r) => r.rule === 'DEL-05' && r.status !== 'pass'), 'class C declared, class B in production: still frozen');
  assert.ok(intake.some((r) => r.rule === 'RES-01' && r.status === 'warn'));
});

test('exposure follows from what is published, and overrides are dependencies too (IAM-01, SEC-05)', () => {
  const m = clone(loadManifest(APP));
  m.provides![0]!.via = 'edge-adc';
  m.provides![0]!.consumers = ['zone:internet'];
  assert.ok(validateManifest(APP, m).some((r) => r.rule === 'IAM-01' && r.status === 'fail' && /makes it internet/.test(r.message)));
  const dir = mkdtempSync(join(tmpdir(), 'overrides-'));
  writeFileSync(join(dir, 'architecture.yaml'), stringify(loadManifest(APP)));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { pg: '8.23.1' }, overrides: { 'pg-protocol': '*', semver: { '.': '7.6.3' } } }));
  const found = checkDependencies(dir).filter((r) => r.status === 'fail').map((r) => r.message);
  assert.ok(found.some((x) => /override for pg-protocol isn't pinned/.test(x)));
  assert.ok(found.some((x) => /override for semver has no recorded reason/.test(x)));
});

test('the gate\'s inputs change only with the Board and Central IT, or by break-glass (SEC-14)', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const idp: Record<string, string[]> = { mellis: ['architecture-board'], jalvarez: ['central-it'], both: ['architecture-board', 'central-it'] };
  const groupsOf = (who: string) => idp[who] ?? [];
  const change = (signers: string[], files = ['enterprise-architecture/governance/exceptions.yaml'], breakGlass?: { reason: string; at: Date }) =>
    ({ commit: 'abc123', files, signers, ...(breakGlass ? { breakGlass } : {}) });
  const status = (c: ReturnType<typeof change>) => judgeGateChanges([c], groupsOf, now)[0]!.status;
  assert.equal(status(change(['mellis', 'jalvarez'])), 'pass');
  assert.equal(status(change(['jalvarez'])), 'fail', 'Central IT alone');
  assert.equal(status(change(['both'])), 'fail', 'one person in both groups is still one person');
  assert.equal(status(change(['jalvarez'], undefined, { reason: 'expiring exception at 02:00, deadline night', at: new Date('2026-10-15T02:00:00Z') })), 'warn');
  assert.equal(status(change(['jalvarez'], undefined, { reason: 'old', at: new Date('2026-10-10T02:00:00Z') })), 'fail');
  assert.equal(status(change(['jalvarez'], ['platforms/power-apps/approved-connectors.yaml'])), 'fail');
  assert.equal(status(change(['jalvarez'], ['platforms/power-apps/standards.md'])), 'pass', 'not a gate input: versioned architecture, approved by the Board as a version');
  // Without the IdP, nobody can say who signed: not a pass.
  assert.equal(judgeGateChanges([change(['mellis', 'jalvarez'])], undefined, now)[0]!.status, 'skip');
});

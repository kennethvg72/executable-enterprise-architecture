// Tests for the audit of the Test Agent's results (DEL-02), and for recording them: the pipeline
// runs none of the candidate's code (SEC-13).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { auditResults, parseTap, sourceNames } from './audit-results.ts';
import { REPO_ROOT, loadPlatform } from './lib/load.ts';
import { runPipeline } from './pipeline.ts';
import { recordEvidence } from './record-evidence.ts';

const write = (file: string, text: string) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text); };

/** An architecture whose platform records with plain Node.js, so the tests need no npm and no network. */
function architecture(): string {
  const root = mkdtempSync(join(tmpdir(), 'arch-'));
  write(join(root, 'platforms', 'typescript-web', 'platform.yaml'), stringify({
    platform: 'typescript-web',
    evidence: [
      { key: 'type-check', name: 'Type check', rule: 'TS-01', run: 'node -e "process.exit(0)"' },
      { key: 'test-results', name: 'Tests', rule: 'DEL-02', run: 'node --test "test/**/*.test.ts"', env: { NODE_OPTIONS: '--test-reporter=tap' }, format: 'tap', tests: '**/*.test.ts' },
    ],
  }));
  return root;
}

/** An application under Git, with these test files, committed, and a candidate that names its evidence. */
function application(tests: Record<string, string>): { dir: string; candidate: string; git: (...a: string[]) => string; commit: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'app-'));
  const git = (...args: string[]) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).stdout.trim();
  git('init', '-q'); git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Test');
  write(join(dir, 'architecture.yaml'), stringify({ application: 'app', runtime: { technology: 'typescript-web' } }));
  for (const [f, text] of Object.entries(tests)) write(join(dir, f), text);
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'change'); };
  commit();
  const candidate = join(dir, 'releases', 'rc-1');
  write(join(candidate, 'candidate.yaml'), stringify({ id: 'rc-1', evidence: { 'type-check': 'releases/rc-1/type-check.txt', 'test-results': 'releases/rc-1/test-results.txt' } }));
  return { dir, candidate, git, commit };
}

const PASSING = { 'test/a.test.ts': "import { test } from 'node:test';\ntest('R-1: one', () => {});\ntest(\"two # with a hash\", () => {});\n" };

/** Record both pieces of evidence, as the Test Agent would, and audit them. */
function recordAndAudit(app: ReturnType<typeof application>, root = architecture()) {
  for (const key of ['type-check', 'test-results']) assert.equal(recordEvidence(key, `releases/rc-1/${key}.txt`, app.dir, root).problem, undefined);
  return auditResults(app.dir, loadPlatform('typescript-web', root), app.candidate);
}
const failures = (results: ReturnType<typeof auditResults>) => results.filter((r) => r.status !== 'pass').map((r) => `${r.rule}: ${r.message}`);

test('evidence recorded on the code being judged, where every test passed, passes the audit (DEL-02)', () => {
  const app = application(PASSING);
  const results = recordAndAudit(app);
  assert.deepEqual(failures(results), []);
  assert.match(results.find((r) => r.rule === 'DEL-02')!.message, /2 of 2 tests passed/);
  assert.match(readFileSync(join(app.candidate, 'test-results.txt'), 'utf8'), new RegExp(`^command: NODE_OPTIONS=--test-reporter=tap node --test "test/\\*\\*/\\*\\.test\\.ts"\ncommit: ${app.git('rev-parse', 'HEAD')}\nexit: 0\n\nTAP version 13`));
});

test('a failed, skipped or vanished test fails the audit', () => {
  const failing = recordAndAudit(application({ 'test/a.test.ts': "import { test } from 'node:test';\ntest('one', () => { throw new Error('no'); });\n" }));
  assert.match(failures(failing).join(), /DEL-02: Tests: exited with 1/);
  const skipped = recordAndAudit(application({ 'test/a.test.ts': "import { test } from 'node:test';\ntest('one', () => {});\ntest('two', { skip: true }, () => {});\n" }));
  assert.match(failures(skipped).join(), /1 skipped[\s\S]*not run: two \(SKIP\)/);
  // A test file the test command doesn't run: its tests disappeared silently.
  const vanished = recordAndAudit(application({ ...PASSING, 'src/b.test.ts': "import { it } from 'node:test';\nit('the forgotten one', () => {});\n" }));
  assert.match(failures(vanished).join(), /1 tests in the source at \w+ have no result: the forgotten one/);
});

test('evidence counts only for the code it was recorded on: only the release folder may change after it', () => {
  const app = application(PASSING);
  assert.deepEqual(failures(recordAndAudit(app)), []);
  // The candidate's commit adds its release folder: still the tested code.
  app.commit();
  assert.deepEqual(failures(auditResults(app.dir, loadPlatform('typescript-web', architecture()), app.candidate)), []);
  // A change to the code after the record, committed or not, makes it evidence of something else.
  write(join(app.dir, 'src', 'main.ts'), 'export {};\n');
  assert.match(failures(auditResults(app.dir, loadPlatform('typescript-web', architecture()), app.candidate)).join(), /the code changed after it \(src\/main\.ts\)/);
  // And the recorder refuses to record uncommitted code at all.
  assert.match(recordEvidence('test-results', 'releases/rc-1/test-results.txt', app.dir, architecture()).problem!, /Uncommitted changes \(src\/main\.ts\)/);
});

test('a record that isn\'t the platform\'s command, the whole output, or a real commit fails the audit', () => {
  const root = architecture();
  const app = application(PASSING);
  recordAndAudit(app, root);
  const file = join(app.candidate, 'test-results.txt');
  const original = readFileSync(file, 'utf8');
  const audit = () => failures(auditResults(app.dir, loadPlatform('typescript-web', root), app.candidate)).join();
  writeFileSync(file, original.replace(/^command: .*$/m, 'command: node --test test/a.test.ts'));
  assert.match(audit(), /not the platform's/);
  writeFileSync(file, original.replace(/^commit: .*$/m, 'commit: 0123456789abcdef0123456789abcdef01234567'));
  assert.match(audit(), /isn't in the repository/);
  // Output that stops after the first result: the plan and the results don't add up.
  writeFileSync(file, original.replace(/# Subtest: two[\s\S]*?\n1\.\.2/, '1..2'));
  assert.match(audit(), /1 results for a plan of 2[\s\S]*have no result: two # with a hash/);
  rmSync(file);
  assert.match(audit(), /Tests: no evidence \(evidence\.test-results/);
});

test('the previous release\'s tests are audited on an earlier commit of the application (DAT-07)', () => {
  const root = architecture();
  const app = application(PASSING);
  const previous = app.git('rev-parse', 'HEAD');
  write(join(app.dir, 'src', 'main.ts'), 'export {};\n');
  app.commit();
  recordAndAudit(app, root);
  const record = readFileSync(join(app.candidate, 'test-results.txt'), 'utf8');
  write(join(app.candidate, 'previous-release-tests.txt'), record.replace(/^commit: .*$/m, `commit: ${previous}`));
  write(join(app.candidate, 'candidate.yaml'), stringify({ id: 'rc-1', evidence: { 'type-check': 'releases/rc-1/type-check.txt', 'test-results': 'releases/rc-1/test-results.txt', 'previous-release-tests': 'releases/rc-1/previous-release-tests.txt' } }));
  const audit = () => auditResults(app.dir, loadPlatform('typescript-web', root), app.candidate);
  assert.deepEqual(failures(audit()), []);
  assert.ok(audit().some((r) => r.rule === 'DAT-07' && r.status === 'pass'));
  // A commit that isn't this application's history isn't its previous release.
  const unrelated = app.git('commit-tree', 'HEAD^{tree}', '-m', 'not in its history');
  write(join(app.candidate, 'previous-release-tests.txt'), record.replace(/^commit: .*$/m, `commit: ${unrelated}`));
  assert.match(failures(audit()).join(), /DAT-07: .*isn't an earlier release/);
});

test('the pipeline never runs the candidate\'s code, whatever its evidence says (SEC-13)', () => {
  const app = application(PASSING);
  const marker = join(mkdtempSync(join(tmpdir(), 'marker-')), 'ran');
  writeFileSync(join(app.dir, 'package.json'), JSON.stringify({ scripts: { test: `node -e "require('fs').writeFileSync('${marker.replace(/\\/g, '/')}', 'ran')"` } }));
  cpSync(join(REPO_ROOT, 'enterprise-architecture', 'tools', 'fixtures', 'registered-app', 'architecture.yaml'), join(app.dir, 'architecture.yaml'));
  app.commit();
  runPipeline(app.dir, { candidateDir: app.candidate, today: new Date('2026-11-01') });
  assert.equal(existsSync(marker), false, 'nothing of the candidate ran');
});

test('TAP is read at every depth, with escaped names and directives, and test names from the source', () => {
  const tap = parseTap('TAP version 13\n# Subtest: s\n    ok 1 - inner \\# one\n    ok 2 - later # TODO not yet\n    1..2\nok 1 - s\nnot ok 2 - broken\n1..2\n# tests 3\n# pass 1\n# fail 1\n# todo 1\n');
  assert.deepEqual(tap.names, ['inner # one', 'later', 's', 'broken']);
  assert.deepEqual([tap.top, tap.planned, tap.failed, tap.directives], [2, 2, ['broken'], ['later (TODO)']]);
  const app = application({ 'test/a.test.ts': "describe('suite', () => { it(\"it's\", () => {}); test.skip(`plain`); test(`with ${'x'}`); });\nt.test('sub \\'q\\'');\n", 'src/not-a-test.ts': "test('ignored')" });
  assert.deepEqual(sourceNames(app.dir, 'HEAD', '**/*.test.ts'), ['suite', "it's", 'plain', "sub 'q'"]);
});

// AGT-12: the intent-drift review's deterministic checks, on real Git repositories.

process.env.NATAX_AUTHORITIES = 'off';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { checkIntent, intentInForce } from './check-intent.ts';
import { REPO_ROOT, clone, loadManifest } from './lib/load.ts';

const FIXTURE = join(REPO_ROOT, 'enterprise-architecture', 'tools', 'fixtures', 'registered-app');

const requirements = (rows: string[], questions: string[] = []) => `# Requirements

## Requirements log

| ID | Date | Entry | Tests |
|---|---|---|---|
${rows.join('\n')}

## Open questions

| ID | Date | Question | Answered by |
|---|---|---|---|
${questions.join('\n')}
`;

const report = (range: string, ids: string[], findings = '') => `# Intent-drift review: rejection-triage

Range: ${range}

## Inventory

| ID | What it says, briefly | Status | Evidence |
|---|---|---|---|
${ids.map((id) => `| ${id} | ... | satisfied, tested | test/x.test.ts |`).join('\n')}

## Findings
${findings}
`;

/** An application repository on enterprise-architecture 2.0.0, with intent and one commit. */
function app(pin = '2.0.0') {
  const dir = mkdtempSync(join(tmpdir(), 'intent-'));
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q'); git('config', 'user.email', 'test@natax.example'); git('config', 'user.name', 'Test');
  const m = clone(loadManifest(FIXTURE));
  m.architecture['enterprise-architecture'] = pin;
  writeFileSync(join(dir, 'architecture.yaml'), stringify(m));
  mkdirSync(join(dir, 'docs', 'decisions'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'reviews'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'requirements.md'), requirements(['| R-001 | 2026-10-01 | Agents see rejections grouped by error code. | |', '| R-002 | 2026-10-02 | Leads can release another agent\'s claim. | |'], ['| Q-001 | 2026-10-02 | Do leads see closed rejections? | |']));
  writeFileSync(join(dir, 'docs', 'decisions', '0001-plain-sql.md'), '# 0001: Plain SQL\n\nStatus: accepted\n');
  git('add', '-A'); git('commit', '-qm', 'intent');
  const first = git('rev-parse', 'HEAD');
  return { dir, git, first };
}

const status = (results: ReturnType<typeof checkIntent>) => results.some((r) => r.status === 'fail') ? 'fail' : results.some((r) => r.status === 'skip') ? 'incomplete' : 'pass';

test('a current report that covers everything in force passes', () => {
  const a = app();
  writeFileSync(join(a.dir, 'docs', 'reviews', '2026-10-22-intent-drift.md'), report(`${a.first}..${a.first}`, ['R-001', 'R-002', 'Q-001', 'D-0001']));
  a.git('add', '-A'); a.git('commit', '-qm', 'drift review');
  assert.equal(status(checkIntent(a.dir)), 'pass');
});

test('a candidate without a drift report is refused', () => {
  const a = app();
  assert.equal(status(checkIntent(a.dir)), 'fail');
});

test('a report older than the latest change to the requirements is refused', () => {
  const a = app();
  writeFileSync(join(a.dir, 'docs', 'reviews', '2026-10-22-intent-drift.md'), report(`${a.first}..${a.first}`, ['R-001', 'R-002', 'Q-001', 'D-0001']));
  a.git('add', '-A'); a.git('commit', '-qm', 'drift review');
  // A new request, after the review.
  const req = join(a.dir, 'docs', 'requirements.md');
  writeFileSync(req, readFileSync(req, 'utf8').replace('| R-002 |', '| R-003 | 2026-10-23 | Show the tax year in the queue. | |\n| R-002 |'));
  a.git('commit', '-qam', 'new request');
  const results = checkIntent(a.dir);
  assert.equal(status(results), 'fail');
  assert.ok(results.some((r) => /stale/.test(r.message)));
});

test('a report whose inventory misses an item in force is refused', () => {
  const a = app();
  writeFileSync(join(a.dir, 'docs', 'reviews', '2026-10-22-intent-drift.md'), report(`${a.first}..${a.first}`, ['R-001', 'Q-001', 'D-0001']));
  a.git('add', '-A'); a.git('commit', '-qm', 'drift review');
  const results = checkIntent(a.dir);
  assert.ok(results.some((r) => r.status === 'fail' && /misses 1 item\(s\) in force: R-002/.test(r.message)));
});

test('a requirement stays in force until a record withdraws it; silence is not deprecation', () => {
  const a = app();
  const req = join(a.dir, 'docs', 'requirements.md');
  const base = readFileSync(req, 'utf8');
  assert.deepEqual(intentInForce(a.dir).inForce, ['R-001', 'R-002', 'Q-001', 'D-0001']);
  // An explicit withdrawal, and a replacement; an answered question; a superseded decision.
  writeFileSync(req, base
    .replace('| R-002 | 2026-10-02 | Leads can release another agent\'s claim. | |', '| R-002 | 2026-10-02 | Leads can release another agent\'s claim. | |\n| R-003 | 2026-10-05 | Deprecates R-001: grouping by tax year instead. | |\n| R-004 | 2026-10-06 | Supersedes R-002: any agent can release a claim older than a day. | |')
    .replace('| Q-001 | 2026-10-02 | Do leads see closed rejections? | |', '| Q-001 | 2026-10-02 | Do leads see closed rejections? | R-004 |'));
  writeFileSync(join(a.dir, 'docs', 'decisions', '0001-plain-sql.md'), '# 0001: Plain SQL\n\nStatus: superseded by 0002\n');
  writeFileSync(join(a.dir, 'docs', 'decisions', '0002-query-builder.md'), '# 0002: A query builder\n\nStatus: accepted\n');
  assert.deepEqual(intentInForce(a.dir).inForce, ['R-003', 'R-004', 'D-0002']);
  // Editing history instead of appending is caught: an ID used twice.
  writeFileSync(req, base.replace('| R-002 | 2026-10-02 |', '| R-001 | 2026-10-02 |'));
  assert.match(intentInForce(a.dir).problems.join(), /used twice: R-001/);
});

test('unresolved contradictions are flagged for the Governance Agent; 1.x isn\'t bound; no Git is incomplete', () => {
  const a = app();
  writeFileSync(join(a.dir, 'docs', 'reviews', '2026-10-22-intent-drift.md'), report(`${a.first}..${a.first}`, ['R-001', 'R-002', 'Q-001', 'D-0001'],
    '\n### F-1: Release contradicts claiming\nClass: contradiction\nItems: R-002, D-0001\nStatus: open\n'));
  a.git('add', '-A'); a.git('commit', '-qm', 'drift review');
  assert.ok(checkIntent(a.dir).some((r) => r.status === 'warn' && /F-1/.test(r.message)));
  assert.equal(status(checkIntent(app('1.0.0').dir)), 'pass');
  const noGit = app();
  rmSync(join(noGit.dir, '.git'), { recursive: true, force: true });
  writeFileSync(join(noGit.dir, 'docs', 'reviews', '2026-10-22-intent-drift.md'), report('abc..def', ['R-001', 'R-002', 'Q-001', 'D-0001']));
  assert.equal(status(checkIntent(noGit.dir)), 'incomplete');
});

test('from 3.0.0, every request in force says why: its own, or a goal\'s (AGT-12)', () => {
  const a = app('3.0.0');
  const text = `# Requirements

## Goals

| ID | Goal | Why |
|---|---|---|
| G-1 | Customers hear about a rejection within a day | A late correction can cost them the filing deadline. |
| G-2 | Fewer calls to support | not given (Q-001) |

## Requirements log

| ID | Date | Entry | Why | Tests |
|---|---|---|---|---|
| R-001 | 2026-10-01 | Agents see rejections grouped by error code. | One fix often solves a whole group. | |
| R-002 | 2026-10-02 | Leads can release another agent's claim. | G-1 | |
| R-003 | 2026-10-03 | Show the tax year in the queue. | not given (Q-002) | |
| R-004 | 2026-10-04 | Export the queue to a spreadsheet. | G-9 | |
| R-005 | 2026-10-05 | Deprecates R-001: grouping by tax year instead. | | |

## Open questions

| ID | Date | Question | Answered by |
|---|---|---|---|
| Q-001 | 2026-10-02 | Why does G-2 matter? | |
| Q-002 | 2026-10-03 | Why should the queue show the tax year? | |
`;
  writeFileSync(join(a.dir, 'docs', 'requirements.md'), text);
  const { withoutWhy } = intentInForce(a.dir);
  // R-001 is withdrawn; R-002 cites a goal with a reason: both fine.
  assert.deepEqual(withoutWhy.map((w) => w.split(' ')[0]), ['G-2', 'R-003', 'R-004', 'R-005']);
  assert.match(withoutWhy.join(), /R-003 \(reason recorded as not given\)/);
  assert.match(withoutWhy.join(), /R-004 \(cites G-9/);
  // A warning while working, a failure for a release candidate.
  a.git('add', '-A'); a.git('commit', '-qm', 'intent');
  const head = a.git('rev-parse', 'HEAD');
  writeFileSync(join(a.dir, 'docs', 'reviews', '2026-10-22-intent-drift.md'), report(`${a.first}..${head}`, ['G-1', 'G-2', 'R-002', 'R-003', 'R-004', 'R-005', 'Q-001', 'Q-002', 'D-0001']));
  a.git('add', '-A'); a.git('commit', '-qm', 'drift review');
  const local = checkIntent(a.dir).filter((r) => /without a reason/.test(r.message));
  assert.deepEqual(local.map((r) => r.status), ['warn']);
  mkdirSync(join(a.dir, 'releases', 'rc-1'), { recursive: true });
  writeFileSync(join(a.dir, 'releases', 'rc-1', 'candidate.yaml'), stringify({ commit: a.git('rev-parse', 'HEAD'), evidence: { 'intent-drift': 'docs/reviews/2026-10-22-intent-drift.md' } }));
  const release = checkIntent(a.dir, { candidateDir: join(a.dir, 'releases', 'rc-1') }).filter((r) => /without a reason/.test(r.message));
  assert.deepEqual(release.map((r) => r.status), ['fail']);
  // 2.x isn't bound by it yet.
  const old = app('2.0.0');
  writeFileSync(join(old.dir, 'docs', 'requirements.md'), text);
  assert.ok(!checkIntent(old.dir).some((r) => /without a reason/.test(r.message)));
});

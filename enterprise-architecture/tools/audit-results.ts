// DEL-02: the pipeline audits the Test Agent's results; it never runs the candidate's code (SEC-13).
//
// The Test Agent records each piece of evidence the platform names with record-evidence.ts: the
// platform's own command, the commit it ran on, its exit code and its raw output. This audit is
// deterministic, and checks the record, not the people who made it:
// - the evidence was recorded with the platform's command, and exited 0;
// - it was recorded on the code being judged: since the tested commit, nothing changed but the
//   candidate's own release folder;
// - every test passed, and nothing was skipped, cancelled or left to do;
// - the counts add up: every test the summary counts has a result, and each result was planned;
// - no test silently disappeared: every test named in the source at that commit has a result.
// A forged record isn't caught here; it is caught by accountability. The Problem Owner answers for
// their agents' evidence, and tampering with it is circumventing policy.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, matchesGlob, relative } from 'node:path';
import type { Platform } from './lib/load.ts';
import { readYaml } from './lib/load.ts';
import { fail, pass, skip, type Result } from './lib/report.ts';

export type Evidence = NonNullable<Platform['evidence']>[number];

/** The previous release's tests, run with the platform's test-results command, on the previous release's commit (DAT-07). */
export const PREVIOUS = 'previous-release-tests';

/** How an evidence record names its command: the environment it adds, then the command. */
export const commandOf = (e: Evidence) => [...Object.entries(e.env ?? {}).map(([k, v]) => `${k}=${v}`), e.run].join(' ');

export interface EvidenceRecord { command?: string; commit?: string; exit?: string; output: string }

/** A record: a few "name: value" lines, an empty line, then the command's output as it was. */
export function parseRecord(text: string): EvidenceRecord {
  const [head = '', ...rest] = text.replace(/\r\n/g, '\n').split('\n\n');
  const fields = Object.fromEntries(head.split('\n').map((l) => /^(\w+): (.*)$/.exec(l)).filter((m) => m).map((m) => [m![1], m![2]!.trim()]));
  return { command: fields.command, commit: fields.commit, exit: fields.exit, output: rest.join('\n\n') };
}

export interface Tap { planned?: number; top: number; names: string[]; failed: string[]; directives: string[]; summary: Map<string, number> }

/** Node.js's TAP output: every result at any depth, the top-level plan, and the summary. */
export function parseTap(output: string): Tap {
  const tap: Tap = { top: 0, names: [], failed: [], directives: [], summary: new Map() };
  for (const line of output.replace(/\r/g, '').split('\n')) {
    const result = /^( *)(not ok|ok) \d+ - (.*)$/.exec(line);
    if (result) {
      const [, indent, status, rest] = result;
      // A directive is an unescaped " # SKIP" or " # TODO"; a "#" in a name is escaped.
      const directive = /(?<!\\) # (SKIP|TODO)\b.*$/i.exec(rest!);
      const name = (directive ? rest!.slice(0, directive.index) : rest!).replace(/\\#/g, '#').replace(/\\\\/g, '\\').trim();
      tap.names.push(name);
      if (status === 'not ok') tap.failed.push(name);
      if (directive) tap.directives.push(`${name} (${directive[1]!.toUpperCase()})`);
      if (!indent) tap.top += 1;
      continue;
    }
    const plan = /^1\.\.(\d+)$/.exec(line);
    if (plan) tap.planned = Number(plan[1]);
    const count = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (count) tap.summary.set(count[1]!, Number(count[2]));
  }
  return tap;
}

/** The test names written as literals in the test files at a commit: test('...'), it("..."), describe(`...`). */
export function sourceNames(appDir: string, commit: string, glob: string): string[] {
  const git = (...args: string[]) => spawnSync('git', ['-C', appDir, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const files = git('ls-tree', '-r', '--name-only', commit).stdout.split('\n').filter((f) => f && matchesGlob(f, glob));
  const names: string[] = [];
  const call = /\b(?:test|it|describe|suite)(?:\.\w+)?\s*\(\s*(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`$\\]*)`)/g;
  for (const f of files) {
    for (const m of git('show', `${commit}:${f}`).stdout.matchAll(call)) names.push((m[1] ?? m[2] ?? m[3]!).replace(/\\(.)/g, '$1'));
  }
  return names;
}

/** What changed since a commit, committed or not: the files that differ from what was tested. */
function changedSince(appDir: string, commit: string): string[] | undefined {
  const git = (...args: string[]) => spawnSync('git', ['-C', appDir, ...args], { encoding: 'utf8' });
  const diff = git('diff', '--name-only', commit, 'HEAD');
  if (diff.status !== 0) return undefined;
  const uncommitted = git('status', '--porcelain', '--untracked-files=all').stdout.split('\n').map((l) => l.slice(3));
  return [...new Set([...diff.stdout.split('\n'), ...uncommitted].filter(Boolean))];
}

function auditTap(e: Evidence, name: string, output: string, appDir: string, commit: string): Result[] {
  const tap = parseTap(output);
  const n = (k: string) => tap.summary.get(k);
  const problems: string[] = [];
  if (n('tests') === undefined || tap.planned === undefined) return [fail(e.rule, `${name}: not a complete TAP output (no plan or no summary), so nothing in it can be counted.`)];
  if (tap.failed.length) problems.push(`failed: ${tap.failed.slice(0, 10).join('; ')}`);
  for (const k of ['fail', 'cancelled', 'skipped', 'todo']) if (n(k)) problems.push(`${n(k)} ${k}`);
  if (tap.directives.length) problems.push(`not run: ${tap.directives.slice(0, 10).join('; ')}`);
  if (!n('tests')) problems.push('no tests ran: a test command that runs nothing proves nothing');
  if (n('pass') !== n('tests')) problems.push(`${n('pass') ?? 0} of ${n('tests')} passed`);
  if (tap.top !== tap.planned) problems.push(`${tap.top} results for a plan of ${tap.planned}`);
  const reported = new Set(tap.names);
  const missing = [...new Set(sourceNames(appDir, commit, e.tests ?? '**/*.test.ts'))].filter((t) => !reported.has(t));
  if (missing.length) problems.push(`${missing.length} tests in the source at ${commit.slice(0, 12)} have no result: ${missing.slice(0, 10).join('; ')}`);
  return problems.length
    ? [fail(e.rule, `${name}: ${problems.join('. ')}.`, 'Every test must pass, and every test in the source must run. Fix the cause, then the Test Agent records the evidence again.')]
    : [pass(e.rule, `${name}: ${n('pass')} of ${n('tests')} tests passed at ${commit.slice(0, 12)}, nothing skipped, and every test in the source has a result.`)];
}

export function auditResults(appDir: string, platform: Platform | undefined, candidateDir: string | undefined): Result[] {
  if (!candidateDir || !existsSync(join(candidateDir, 'candidate.yaml'))) return [skip('DEL-02', 'No release candidate: the Test Agent\'s results are audited for a candidate (--candidate releases/<id>).')];
  const entries = platform?.evidence ?? [];
  if (!entries.length) return [skip('DEL-02', `The platform ${platform?.platform ?? '?'} names no evidence to audit.`)];
  const evidence = readYaml<{ evidence?: Record<string, unknown> }>(join(candidateDir, 'candidate.yaml'))?.evidence ?? {};
  const release = relative(appDir, candidateDir).replace(/\\/g, '/');
  const tests = entries.find((e) => e.key === 'test-results');
  const audited: [string, Evidence][] = entries.map((e) => [e.key, e]);
  if (evidence[PREVIOUS] && tests) audited.push([PREVIOUS, { ...tests, key: PREVIOUS, name: 'The previous release\'s tests, against the new schema', rule: 'DAT-07' }]);

  const results: Result[] = [];
  for (const [key, e] of audited) {
    const path = evidence[key];
    const fix = `The Test Agent records it, on the committed code: node <architecture>/enterprise-architecture/tools/record-evidence.ts ${key} ${release}/${key}.txt, and the candidate names it as evidence.${key}.`;
    if (typeof path !== 'string' || !existsSync(join(appDir, path))) { results.push(fail(e.rule, `${e.name}: no evidence (evidence.${key} in candidate.yaml).`, fix)); continue; }
    const record = parseRecord(readFileSync(join(appDir, path), 'utf8'));
    if (record.command !== commandOf(e)) { results.push(fail(e.rule, `${e.name}: recorded with "${record.command ?? 'no command'}", not the platform's "${commandOf(e)}".`, fix)); continue; }
    if (!record.commit || spawnSync('git', ['-C', appDir, 'cat-file', '-e', `${record.commit}^{commit}`]).status !== 0) { results.push(fail(e.rule, `${e.name}: recorded on commit ${record.commit ?? '?'}, which isn't in the repository.`, fix)); continue; }
    if (key === PREVIOUS) {
      if (spawnSync('git', ['-C', appDir, 'merge-base', '--is-ancestor', record.commit, 'HEAD']).status !== 0) { results.push(fail(e.rule, `${e.name}: recorded on ${record.commit.slice(0, 12)}, which isn't an earlier release of this application.`, fix)); continue; }
    } else {
      const changed = changedSince(appDir, record.commit)?.filter((f) => !f.startsWith(`${release}/`));
      if (!changed) { results.push(fail(e.rule, `${e.name}: what changed since ${record.commit.slice(0, 12)} can't be shown.`, fix)); continue; }
      if (changed.length) { results.push(fail(e.rule, `${e.name}: recorded on ${record.commit.slice(0, 12)}, and the code changed after it (${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', ...' : ''}): it isn't evidence for this candidate.`, fix)); continue; }
    }
    if (record.exit !== '0') { results.push(fail(e.rule, `${e.name}: exited with ${record.exit ?? 'no exit code'}.`, 'Fix the cause, then the Test Agent records the evidence again.')); continue; }
    results.push(...(e.format === 'tap' ? auditTap(e, e.name, record.output, appDir, record.commit) : [pass(e.rule, `${e.name}: exited 0 at ${record.commit.slice(0, 12)}.`)]));
  }
  return results;
}

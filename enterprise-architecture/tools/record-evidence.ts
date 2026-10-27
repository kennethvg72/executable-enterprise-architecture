// DEL-02: the Test Agent records a piece of evidence for a release candidate. It runs the
// platform's own command (platform.yaml), on committed code only, and writes what the pipeline
// audits (audit-results.ts): the command, the commit, the exit code and the raw output. The
// pipeline never runs this itself (SEC-13): the record is the Test Agent's, under the Problem
// Owner's accountability.
//
// Usage, in the application's repository:
//   node <architecture>/enterprise-architecture/tools/record-evidence.ts <key> <file>
// <key> is one of the platform's evidence keys, or previous-release-tests: the platform's tests,
// run in a checkout of the previous release against the new schema (DAT-07).

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PREVIOUS, commandOf } from './audit-results.ts';
import { REPO_ROOT, loadManifest, loadPlatform } from './lib/load.ts';

export function recordEvidence(key: string, file: string, appDir: string, root = REPO_ROOT): { exit?: number; problem?: string } {
  const platform = loadPlatform(loadManifest(appDir).runtime.technology, root);
  const entry = (platform?.evidence ?? []).find((e) => e.key === key || (key === PREVIOUS && e.key === 'test-results'));
  if (!entry) return { problem: `The platform ${platform?.platform ?? '?'} names no evidence "${key}": ${(platform?.evidence ?? []).map((e) => e.key).concat(PREVIOUS).join(', ')}.` };
  const git = (...args: string[]) => spawnSync('git', ['-C', appDir, ...args], { encoding: 'utf8' });
  const commit = git('rev-parse', 'HEAD').stdout.trim();
  if (!commit) return { problem: `${appDir} isn't a Git repository with a commit: evidence is recorded on a commit.` };
  // Uncommitted code would make the record evidence of nothing. Only the release folders may differ.
  const dirty = git('status', '--porcelain', '--untracked-files=all').stdout.split('\n').map((l) => l.slice(3)).filter((f) => f && !f.startsWith('releases/'));
  if (dirty.length) return { problem: `Uncommitted changes (${dirty.slice(0, 5).join(', ')}): commit them first, so the record says what was tested.` };
  // Started from inside another test run, Node.js would report to that run instead of in its output.
  const { NODE_TEST_CONTEXT: _, ...env } = process.env;
  const r = spawnSync(entry.run, { cwd: appDir, shell: true, encoding: 'utf8', env: { ...env, ...entry.env }, maxBuffer: 256 * 1024 * 1024 });
  const exit = r.status ?? 1;
  mkdirSync(dirname(resolve(appDir, file)), { recursive: true });
  writeFileSync(resolve(appDir, file), `command: ${commandOf(entry)}\ncommit: ${commit}\nexit: ${exit}\n\n${r.stdout ?? ''}${r.stderr ?? ''}`);
  return { exit };
}

if (import.meta.main) {
  const [key, file] = process.argv.slice(2);
  if (!key || !file) { console.error('Usage: record-evidence.ts <key> <file>, in the application\'s repository.'); process.exit(2); }
  const { exit, problem } = recordEvidence(key, file, process.cwd());
  if (problem) { console.error(`NOT RECORDED: ${problem}`); process.exit(2); }
  console.log(`Recorded ${key} in ${file}: exit ${exit}.`);
  process.exitCode = exit === 0 ? 0 : 1;
}

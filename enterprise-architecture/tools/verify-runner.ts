// Verifies the pipeline's runner (SEC-13) with the hostile canary (fixtures/hostile-candidate). Two
// different properties, checked separately:
// - Isolation: in "escape", every attempt to get out of the runner must fail.
// - Disposability: what one runner leaves, the next must not find. That takes two runners, so the
//   trusted launcher runs "plant" in one, destroys it, creates another, and runs "check" there.
//   Two processes in the same runner would only prove the processes are separate.
// Exit code 0 only when every attempt failed and the run was complete: automation reads the exit
// code, not the message. The pipeline runs "preflight" right before every candidate's code.
//
// Usage, inside a runner: node enterprise-architecture/tools/verify-runner.ts [--phase escape|plant|check]
// Run anywhere else, it reports what a candidate could do there, which is the point.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/load.ts';
import { fail, format, pass, type Result } from './lib/report.ts';

const CANARY = join(REPO_ROOT, 'enterprise-architecture', 'tools', 'fixtures', 'hostile-candidate');

export type Phase = 'escape' | 'plant' | 'check' | 'preflight';

/** The attempts the real canary makes in each phase. A run that reports fewer didn't finish. */
const ESCAPES = [
  "no credentials in the environment, except the run's own test database",
  'no credential files are readable',
  'nothing outside the workspace is writable',
  'the internet is unreachable',
  'production is unreachable',
];
export const EXPECTED: Record<Phase, string[]> = {
  escape: ESCAPES,
  plant: ['markers planted for the next runner'],
  check: ['nothing survives from one runner to the next'],
  preflight: [...ESCAPES, 'nothing left by an earlier run'],
};

/**
 * Runs the canary once, in this environment, and judges the run as well as its results: the
 * process must exit cleanly, report a plan, and complete every expected attempt, with nothing
 * skipped. A canary that says "ok 1" and then crashes has verified nothing.
 */
export function verifyRunner(options: { canary?: string; phase?: Phase; env?: NodeJS.ProcessEnv; expected?: string[] } = {}): Result[] {
  const phase = options.phase ?? 'escape';
  // A canary started from inside another test run would report to that run instead of in TAP.
  const { NODE_TEST_CONTEXT: _, ...env } = options.env ?? process.env;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'escape.canary.ts'], {
    cwd: options.canary ?? CANARY, encoding: 'utf8', timeout: 120_000,
    env: { ...env, NATAX_CANARY_PHASE: phase, ARCHITECTURE: REPO_ROOT },
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const results: Result[] = [];
  const lines = [...output.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)];
  for (const m of lines) {
    const name = m[2]!.trim();
    if (m[1] === 'ok') { results.push(pass('SEC-13', `${phase}: ${name}.`)); continue; }
    const detail = new RegExp(`not ok \\d+ - ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?error: (?:\\|-\\s*\\n\\s*)?'?([^'\\n]*)`).exec(output)?.[1]?.trim();
    results.push(fail('SEC-13', `${phase}: escaped. Expected: ${name}${detail ? ` (${detail})` : ''}.`, 'Fix the runner, not the canary.'));
  }
  // The run itself: finished, complete, nothing skipped.
  const count = (label: string) => Number(new RegExp(`^# ${label} (\\d+)$`, 'm').exec(output)?.[1] ?? 'NaN');
  const planned = Number(/^1\.\.(\d+)$/m.exec(output)?.[1] ?? 'NaN');
  const problems: string[] = [];
  if (r.error || r.signal) problems.push(`it didn't finish (${r.error?.message ?? r.signal})`);
  if (r.status !== 0 && !lines.some((m) => m[1] === 'not ok')) problems.push(`it exited with ${r.status} without reporting a failed attempt`);
  if (!(planned === lines.length && count('tests') === lines.length)) problems.push(`it reported ${lines.length} results for a plan of ${planned}`);
  if (count('skipped') !== 0 || count('todo') !== 0 || count('cancelled') !== 0) problems.push('attempts were skipped, cancelled or left to do');
  // Always by name: a test file that exits early is reported by Node.js as one passing test named
  // after the file, with a plan and a summary that agree.
  const expected = options.expected ?? EXPECTED[phase];
  const names = lines.map((m) => m[2]!.trim());
  if (names.length !== expected.length || expected.some((n) => !names.includes(n))) problems.push(`it ran ${names.length} of the ${expected.length} attempts expected in "${phase}"`);
  if (problems.length) results.push(fail('SEC-13', `${phase}: the canary's run doesn't count: ${problems.join('; ')}.${lines.length ? '' : `\n${output.slice(-1000)}`}`, 'Find out why the canary didn\'t complete; an incomplete run verifies nothing.'));
  return results;
}

if (import.meta.main) {
  // --phase escape (default) | plant | check. Disposability takes two runners: the launcher runs
  // --phase plant in one, destroys it, creates another, and runs --phase check there.
  // --canary <dir>: another canary, for this tool's own tests. The pipeline always uses the real one.
  const arg = (name: string) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
  const phase = (arg('--phase') ?? 'escape') as Phase;
  if (!['escape', 'plant', 'check'].includes(phase)) { console.error('--phase must be escape, plant or check.'); process.exit(2); }
  const canary = arg('--canary');
  const expected = arg('--expect')?.split('|');
  const results = verifyRunner({ phase, ...(canary ? { canary } : {}), ...(expected ? { expected } : {}) });
  console.log(format('Runner isolation (SEC-13)', results, { verbose: true }));
  const isolated = !results.some((r) => r.status === 'fail');
  console.log(isolated
    ? `ISOLATED: every attempt in "${phase}" failed, and the run was complete.`
    : 'NOT ISOLATED: a release candidate could do the above here. Never run candidates with --isolated in this environment.');
  // Fail closed: automation reads the exit code, not the message.
  process.exitCode = isolated ? 0 : 1;
}

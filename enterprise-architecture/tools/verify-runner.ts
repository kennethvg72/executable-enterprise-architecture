// Verifies that the pipeline's runner isolates release candidates (SEC-13), by running the
// hostile canary (fixtures/hostile-candidate) in it twice, the way the pipeline runs a candidate.
// Every escape attempt must fail, in both runs. The second run must start in a fresh runner;
// if anything from the first run is still there, the runner isn't disposable.
//
// Usage, inside the runner: node enterprise-architecture/tools/verify-runner.ts
// Run anywhere else, it reports what a candidate could do there, which is the point.
// Exit code 0 only when every attempt failed: automation reads the exit code, not the message.
//
// The pipeline also runs the canary itself, once, right before every candidate's code
// (pipeline.ts, "preflight"): --isolated is then checked, not just asserted.

import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { REPO_ROOT } from './lib/load.ts';
import { fail, format, pass, type Result } from './lib/report.ts';

const CANARY = join(REPO_ROOT, 'enterprise-architecture', 'tools', 'fixtures', 'hostile-candidate');

export function verifyRunner(options: { canary?: string; runs?: string[]; env?: NodeJS.ProcessEnv; cleanup?: boolean } = {}): Result[] {
  const results: Result[] = [];
  // A canary started from inside another test run would report to that run instead of in TAP.
  const { NODE_TEST_CONTEXT: _, ...env } = options.env ?? process.env;
  for (const run of options.runs ?? ['1', '2']) {
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'escape.canary.ts'], {
      cwd: options.canary ?? CANARY, encoding: 'utf8', timeout: 120_000,
      env: { ...env, NATAX_CANARY_RUN: run, ARCHITECTURE: REPO_ROOT },
    });
    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    // TAP: "ok 1 - name" or "not ok 1 - name", followed by the failure's message for the latter.
    for (const m of output.matchAll(/^(not ok|ok) \d+ - (.+)$/gm)) {
      const name = m[2]!.trim();
      if (m[1] === 'ok') { results.push(pass('SEC-13', `Run ${run}: ${name}.`)); continue; }
      const detail = new RegExp(`not ok \\d+ - ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?error: (?:\\|-\\s*\\n\\s*)?'?([^'\\n]*)`).exec(output)?.[1]?.trim();
      results.push(fail('SEC-13', `Run ${run}: escaped. Expected: ${name}${detail ? ` (${detail})` : ''}.`, 'Fix the runner, not the canary.'));
    }
    if (!/^(not )?ok \d+ - /m.test(output)) results.push(fail('SEC-13', `Run ${run}: the canary didn't run:\n${output.slice(-1000)}`));
  }
  // Outside a disposable runner, the first run's markers would otherwise stay behind. The
  // pipeline's preflight keeps them: they are how the next run proves this one left nothing.
  if (options.cleanup !== false) for (const marker of [join(tmpdir(), 'natax-canary-marker'), join(homedir(), '.natax-canary-marker')]) rmSync(marker, { force: true });
  return results;
}

if (import.meta.main) {
  // --canary <dir>: another canary, for this tool's own tests. The pipeline always uses the real one.
  const at = process.argv.indexOf('--canary');
  const results = verifyRunner(at > 0 && process.argv[at + 1] ? { canary: process.argv[at + 1]! } : {});
  console.log(format('Runner isolation (SEC-13)', results, { verbose: true }));
  const isolated = !results.some((r) => r.status === 'fail');
  console.log(isolated
    ? 'ISOLATED: every escape attempt failed, in both runs.'
    : 'NOT ISOLATED: a release candidate could do the above here. Never run candidates with --isolated in this environment.');
  // Fail closed: automation reads the exit code, not the message.
  process.exitCode = isolated ? 0 : 1;
}

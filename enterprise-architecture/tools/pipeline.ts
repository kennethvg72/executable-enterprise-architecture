// The deterministic stage of the central pipeline (pipeline/README.md, stage 3), for one
// application. The Governance Agent runs this and includes the output in its verdict.
//
// Usage: npm run pipeline -- <application repository> [--candidate releases/<id>] [--today YYYY-MM-DD]
//
// A check that can't run here (no test database, no installed dependencies) is reported as
// SKIPPED, never as passed.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { verifyInfrastructure } from '../../infrastructure/tools/verify.ts';
import { verifyNetwork } from '../../network/tools/verify.ts';
import { checkDependencies } from './check-dependencies.ts';
import { checkLinks } from './check-links.ts';
import { REPO_ROOT, loadManifest, loadModel, loadPlatform, readYaml, withApplications } from './lib/load.ts';
import { fail, failed, format, pass, skip, type Result } from './lib/report.ts';
import { scanSecrets } from './scan-secrets.ts';
import { validateManifest } from './validate-manifest.ts';

interface Candidate { id: string; application: string; purpose: string }

/** DEL-05: from April 16 to May 3, class A and B release only fixes. */
export function checkFreeze(today: Date, resilienceClass: string, purpose: string | undefined): Result {
  const month = today.getUTCMonth() + 1;
  const day = today.getUTCDate();
  const frozen = (month === 4 && day >= 16) || (month === 5 && day <= 3);
  if (!frozen) return pass('DEL-05', 'Not in the peak freeze.');
  if (resilienceClass === 'C') return pass('DEL-05', 'In the peak freeze, but class C is not frozen.');
  if (!purpose) return skip('DEL-05', 'In the peak freeze; no candidate given, so its purpose is unknown.');
  return purpose === 'fix' || purpose === 'security-fix'
    ? pass('DEL-05', `In the peak freeze; purpose "${purpose}" may be released. The Governance Agent checks it really is a fix.`)
    : fail('DEL-05', `In the peak freeze, class ${resilienceClass} may release only fixes, not "${purpose}".`, 'Wait until May 4, or release only the fix.');
}

function run(command: string, args: string[], cwd: string): { ok: boolean; output: string } {
  // npm and npx are scripts on Windows, which need a shell. The arguments are constants.
  const r = spawnSync([command, ...args].join(' '), { cwd, encoding: 'utf8', shell: true, timeout: 600_000 });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export function runPipeline(appDir: string, options: { candidateDir?: string | undefined; today?: Date } = {}): { sections: [string, Result[]][]; ok: boolean } {
  const manifest = loadManifest(appDir);
  const sections: [string, Result[]][] = [];
  const candidate = options.candidateDir && existsSync(join(options.candidateDir, 'candidate.yaml'))
    ? readYaml<Candidate>(join(options.candidateDir, 'candidate.yaml'))
    : undefined;

  const intake: Result[] = [...validateManifest(appDir, manifest, { ...(options.today ? { today: options.today } : {}) })];
  intake.push(checkFreeze(options.today ?? new Date(), manifest.resilience.class, candidate?.purpose));
  if (options.candidateDir && !candidate) intake.push(fail('INTAKE', `No candidate.yaml in ${options.candidateDir}.`));
  if (candidate && candidate.application !== manifest.application) intake.push(fail('INTAKE', `The candidate is for ${candidate.application}, not ${manifest.application}.`));
  sections.push(['Intake and manifest', intake]);

  sections.push(['Secrets (SEC-03)', scanSecrets(appDir)]);
  sections.push(['Dependencies (SIM-01, SIM-05, SEC-05)', checkDependencies(appDir)]);
  // The application as registered in the landscape, or with provisional addresses if it isn't yet.
  const registered = loadModel().services.has(manifest.application);
  sections.push(['Network policy (network)', verifyNetwork(withApplications(loadModel(), [appDir]), { drift: registered })]);
  sections.push(['Infrastructure (load balancing, capacity, resilience)', verifyInfrastructure(withApplications(loadModel(), [appDir]), { drift: registered })]);
  sections.push(['Documentation links', checkLinks()]);

  // The platform's own checks (platforms/<name>/platform.yaml), in the application's directory.
  const app: Result[] = [];
  const platform = loadPlatform(manifest.runtime.technology);
  for (const c of platform?.checks ?? []) {
    const available = c.needs === 'node_modules' ? existsSync(join(appDir, 'node_modules'))
      : c.needs === 'gradlew' ? existsSync(join(appDir, 'gradlew'))
      : run(`${c.needs} --version`, [], appDir).ok;
    if (!available) { app.push(skip(c.rule, `${c.name}: needs ${c.needs}, which isn't available here.`)); continue; }
    if (c.database && !process.env.TEST_DATABASE_URL && !existsSync(join(appDir, '.env'))) {
      app.push(skip(c.rule, `${c.name}: no test database configured (TEST_DATABASE_URL).`));
      continue;
    }
    const r = run(c.run, [], appDir);
    const summary = r.output.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l)).map((l) => l.slice(2)).join(', ');
    const detail = summary ? ` (${summary})` : `:\n${r.output.trim().slice(-2000)}`;
    app.push(r.ok ? pass(c.rule, `${c.name} passed${summary ? ` (${summary})` : ''}.`) : fail(c.rule, `${c.name} failed${detail}.`));
    const skipped = Number(/skipped (\d+)/.exec(summary)?.[1] ?? '0');
    if (skipped) app.push(fail(c.rule, `${skipped} tests were skipped. Tests must not skip silently.`));
  }
  sections.push([`Application (${manifest.runtime.technology})`, app]);

  return { sections, ok: !sections.some(([, r]) => failed(r)) };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { candidate: { type: 'string' }, today: { type: 'string' } } });
  const appDir = resolve(positionals[0] ?? '.');
  const candidateDir = values.candidate ? resolve(appDir, values.candidate) : undefined;
  const { sections, ok } = runPipeline(appDir, { candidateDir, ...(values.today ? { today: new Date(values.today) } : {}) });
  console.log(`# Deterministic stage: ${appDir.replace(REPO_ROOT, '').replace(/^[\\/]/, '')}\n`);
  for (const [title, results] of sections) console.log(format(title, results, { verbose: process.argv.includes('--verbose') }));
  const all = sections.flatMap(([, r]) => r);
  const skipped = all.filter((r) => r.status === 'skip').length;
  console.log(`**Deterministic stage: ${ok ? 'PASS' : 'FAIL'}**${skipped ? ` (${skipped} skipped: see above; skipped checks are not passes)` : ''}`);
  // A PASS here is not a release approval. Say plainly what this stage did not check.
  console.log([
    '',
    'Not checked by this command (described in pipeline/checks.md, not implemented in this proof of concept):',
    'signed Release and review evidence (AGT-01, AGT-06); registry provenance and vulnerability scan (SEC-05);',
    'security finding age (SEC-08); backup restore and site exercise records (DAT-08, RES-09); load test (RES-10);',
    'workload identity and mTLS (IAM-05); contract tests against real providers (INT-03, INT-06);',
    "test and acceptance deployment, probes, the Security Agent's attack (SEC-12), failure tests and rollback rehearsal (stages 5 and 6).",
    'The Governance Agent judges these, and the review rules, before any verdict.',
  ].join('\n'));
  const platform = loadPlatform(loadManifest(appDir).runtime.technology);
  if (platform?.['required-evidence']?.length) {
    console.log(`\nAlso required on ${platform.platform}, not automated here:\n${platform['required-evidence'].map((e) => `- ${e}`).join('\n')}`);
  }
  if (!ok) process.exitCode = 1;
}

// The deterministic stage of the central pipeline (pipeline/README.md, stage 3), for one
// application. The Governance Agent runs this and includes the output in its verdict.
//
// Usage: npm run pipeline -- <application repository> [--candidate releases/<id>] [--today YYYY-MM-DD] [--isolated]
//
// Three results, because a check that didn't run proves nothing:
//   PASS        every mandatory check ran and passed                    exit 0
//   FAIL        at least one check failed                               exit 1
//   INCOMPLETE  nothing failed, but a mandatory check couldn't run      exit 3
// Only PASS lets the stage pass. A check that can't run is reported as SKIPPED, never as passed.
//
// The platform's checks run the candidate's own code: its tests, its build scripts, and tools
// installed from its lockfile. That code is untrusted (SEC-13). It runs only with --isolated,
// which states that this process is inside a disposable runner whose isolation the hostile
// canary has verified (verify-runner.ts). --isolated doesn't create isolation; it only says
// it exists. Without it, those checks are skipped and the stage is INCOMPLETE.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { verifyInfrastructure } from '../../infrastructure/tools/verify.ts';
import { verifyNetwork } from '../../network/tools/verify.ts';
import { checkDependencies } from './check-dependencies.ts';
import { checkIntent } from './check-intent.ts';
import { checkLinks } from './check-links.ts';
import { REPO_ROOT, intentChanges, loadManifest, loadModel, loadPlatform, readYaml, withApplications } from './lib/load.ts';
import { applyExceptions, exceptionsFor } from './lib/exceptions.ts';
import { fail, failed, format, pass, skip, warn, type Result } from './lib/report.ts';
import { scanSecrets } from './scan-secrets.ts';
import { validateManifest } from './validate-manifest.ts';
import { verifyRunner } from './verify-runner.ts';
import { GATE_INPUTS, judgeGateChanges } from './verify-gate-inputs.ts';

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

export type Status = 'PASS' | 'FAIL' | 'INCOMPLETE';
export const EXIT_CODE: Record<Status, number> = { PASS: 0, FAIL: 1, INCOMPLETE: 3 };

/** What candidate code may see of the environment: enough to run, no credentials (SEC-13). */
function candidateEnv(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'ComSpec', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEST_DATABASE_URL', 'NODE_ENV'];
  return Object.fromEntries(keep.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]));
}

/**
 * A digest of every file in the architecture repository, tracked or not, to detect tampering.
 * Not just what Git tracks: a planted file that nothing tracks can still be read.
 */
export function architectureDigest(root = REPO_ROOT): Map<string, string> {
  const digests = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) digests.set(relative(root, full), createHash('sha256').update(readFileSync(full)).digest('hex'));
      else digests.set(relative(root, full), `special file: ${entry.isSymbolicLink() ? 'symlink' : 'other'}`);
    }
  };
  walk(root);
  return digests;
}

export function diffDigests(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((f) => before.get(f) !== after.get(f));
}

function run(command: string, args: string[], cwd: string): { ok: boolean; output: string } {
  // npm and npx are scripts on Windows, which need a shell. The commands are constants from the
  // platform's platform.yaml; what they execute is the candidate's code, hence --isolated.
  const r = spawnSync([command, ...args].join(' '), { cwd, encoding: 'utf8', shell: true, timeout: 600_000, env: candidateEnv() });
  return { ok: r.status === 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export function runPipeline(appDir: string, options: { candidateDir?: string | undefined; today?: Date; isolated?: boolean; preflight?: () => Result[] } = {}): { sections: [string, Result[]][]; status: Status } {
  const manifest = loadManifest(appDir);
  const sections: [string, Result[]][] = [];
  const candidate = options.candidateDir && existsSync(join(options.candidateDir, 'candidate.yaml'))
    ? readYaml<Candidate>(join(options.candidateDir, 'candidate.yaml'))
    : undefined;

  const intake: Result[] = [...validateManifest(appDir, manifest, { ...(options.today ? { today: options.today } : {}) })];
  // The freeze applies to the class production has: declaring a lower one in the candidate
  // doesn't escape it, and lowering a class is itself something to review (DEL-05, RES-01).
  const registeredClass = loadModel().services.get(manifest.application)?.class;
  const rank = (c: string | undefined) => ({ A: 0, B: 1, C: 2 } as Record<string, number>)[c ?? 'C'] ?? 2;
  const effectiveClass = rank(registeredClass) < rank(manifest.resilience.class) ? registeredClass! : manifest.resilience.class;
  intake.push(checkFreeze(options.today ?? new Date(), effectiveClass, candidate?.purpose));
  if (registeredClass && rank(manifest.resilience.class) > rank(registeredClass)) {
    intake.push(warn('RES-01', `The candidate lowers ${manifest.application} from class ${registeredClass} to ${manifest.resilience.class}. That's the Problem Owner's decision, with a decision record; until it's in production, class ${registeredClass} applies.`));
  }
  if (options.candidateDir && !candidate) intake.push(fail('INTAKE', `No candidate.yaml in ${options.candidateDir}.`));
  if (candidate && candidate.application !== manifest.application) intake.push(fail('INTAKE', `The candidate is for ${candidate.application}, not ${manifest.application}.`));
  intake.push(...checkApprovedArchitecture(Object.keys(manifest.architecture ?? {})));
  // SEC-14: the gate's own inputs, signed by the Board and Central IT. It needs the workforce IdP to
  // say who is in which group, which this proof of concept doesn't have.
  intake.push(...judgeGateChanges([{ commit: 'HEAD', files: GATE_INPUTS.filter((g) => !g.includes('*')), signers: [] }], undefined, options.today ?? new Date()));
  intake.push(...checkPinnedVersions(manifest.architecture ?? {}));
  sections.push(['Intake and manifest', intake]);
  sections.push(['Intent (AGT-12)', checkIntent(appDir, { candidateDir: options.candidateDir })]);

  sections.push(['Secrets (SEC-03)', scanSecrets(appDir)]);
  sections.push(['Dependencies (SIM-01, SIM-05, SEC-05)', checkDependencies(appDir)]);
  // The model as the candidate asks for it: its manifest's intent, on the landscape's addresses.
  // A change to a registered application is checked exactly like a new application (lib/load.ts).
  const platform = loadPlatform(manifest.runtime.technology);
  const production = loadModel().services.get(manifest.application);
  const proposed = withApplications(loadModel(), [appDir]).services.get(manifest.application);
  const impact = (): Result[] => {
    if (platform?.['runs-on'] !== 'datacenters') return [pass('IMPACT', `Runs on ${platform?.['runs-on'] ?? 'an unknown platform'}: no hosts of its own in NATAX's datacenters.`)];
    if (!production || !proposed) return [pass('IMPACT', 'Not in production yet: everything it asks for is new, and checked below.')];
    const changes = intentChanges(production, proposed);
    return changes.length
      ? changes.map((c) => pass('IMPACT', `Changes: ${c}. Checked below.`))
      : [pass('IMPACT', 'No change to its network or infrastructure intent.')];
  };
  sections.push(['Changes against production (impact)', impact()]);
  sections.push(['Network policy (network)', verifyNetwork(withApplications(loadModel(), [appDir]), { drift: false })]);
  sections.push(['Infrastructure (load balancing, capacity, resilience)', verifyInfrastructure(withApplications(loadModel(), [appDir]), { drift: false })]);
  sections.push(['Documentation links', checkLinks()]);

  // Everything above is judged from the architecture. Only now does the candidate's own code run:
  // last, in a copy of its repository, with none of the pipeline's environment, and with the
  // architecture checked afterwards for tampering. Its results are its claims (SEC-13).
  const app: Result[] = [];
  // An optional check that can't run is a warning; a mandatory one makes the stage incomplete.
  const notRun = (c: { rule: string; optional?: boolean }, message: string) =>
    app.push(c.optional ? warn(c.rule, `Optional, not run: ${message}`) : skip(c.rule, message));
  if (!options.isolated) {
    for (const c of platform?.checks ?? []) notRun({ ...c, rule: 'SEC-13' }, `${c.name}: runs the candidate's own code, so only in a disposable runner (--isolated).`);
  } else {
    // --isolated is an assertion. Check it: the hostile canary runs here first, with the same
    // environment the candidate gets, and finds what an earlier run left behind. Any escape, and
    // the candidate's code doesn't run at all.
    const preflight = (options.preflight ?? (() => verifyRunner({ phase: 'preflight', env: candidateEnv() })))();
    const escaped = preflight.filter((r) => r.status === 'fail');
    if (escaped.length) {
      app.push(fail('SEC-13', `This runner isn't isolated, so the candidate's code didn't run: ${escaped.map((r) => r.message).join(' ')}`, 'Run candidates only in a disposable runner that the hostile canary verifies (verify-runner.ts).'));
      sections.push([`Application (${manifest.runtime.technology})`, app]);
      return { sections, status: 'FAIL' };
    }
    app.push(pass('SEC-13', `The hostile canary found no way out of this runner, and nothing left by an earlier run (${preflight.length} attempts).`));
    const before = architectureDigest();
    const workspace = mkdtempSync(join(tmpdir(), 'candidate-'));
    try {
      cpSync(appDir, workspace, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src.slice(appDir.length)) });
      let installed = true;
      if (platform?.install) {
        const r = run(platform.install, [], workspace);
        installed = r.ok;
        app.push(r.ok
          ? pass('SEC-13', `Dependencies installed by the pipeline, from the lockfile: ${platform.install}.`)
          : fail('SEC-13', `Installing dependencies failed (${platform.install}):\n${r.output.trim().slice(-2000)}`));
      }
      for (const c of installed ? platform?.checks ?? [] : []) {
        const available = c.needs === 'node_modules' ? existsSync(join(workspace, 'node_modules'))
          : c.needs === 'gradlew' ? existsSync(join(workspace, 'gradlew'))
          : run(`${c.needs} --version`, [], workspace).ok;
        if (!available) { notRun(c, `${c.name}: needs ${c.needs}, which isn't available here.`); continue; }
        if (c.database && !process.env.TEST_DATABASE_URL && !existsSync(join(workspace, '.env'))) {
          notRun(c, `${c.name}: no test database configured (TEST_DATABASE_URL).`);
          continue;
        }
        const r = run(c.run, [], workspace);
        // The exit code decides. The counts come from the candidate's own output: its claims.
        const summary = r.output.split('\n').filter((l) => /^ℹ (tests|pass|fail|skipped) /.test(l)).map((l) => l.slice(2)).join(', ');
        const claimed = summary ? ` (the candidate reports: ${summary})` : '';
        app.push(r.ok
          ? pass(c.rule, `${c.name} exited successfully${claimed}.`)
          : fail(c.rule, `${c.name} failed${claimed || `:\n${r.output.trim().slice(-2000)}`}.`));
        const ran = Number(/tests (\d+)/.exec(summary)?.[1] ?? '0');
        if (r.ok && c.counts === 'node-test' && ran === 0) app.push(fail(c.rule, `${c.name} exited successfully, but no tests ran. A test command that runs nothing proves nothing.`));
        const skipped = Number(/skipped (\d+)/.exec(summary)?.[1] ?? '0');
        if (skipped) app.push(fail(c.rule, `${skipped} tests were skipped. Tests must not skip silently.`));
      }
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
    const changed = diffDigests(before, architectureDigest());
    app.push(changed.length
      ? fail('SEC-13', `The architecture changed while the candidate's code ran: ${changed.slice(0, 10).join(', ')}. Every result of this run is void.`, 'Restore the architecture from its repository, and run the candidate again in a runner where the architecture is read-only.')
      : pass('SEC-13', "The architecture was unchanged after the candidate's code ran."));
  }
  sections.push([`Application (${manifest.runtime.technology})`, app]);

  // Board exceptions: validated, then applied to exactly their rules for this application. An
  // invalid exception covers nothing, and is itself a failure.
  const { valid, problems } = exceptionsFor(manifest.application, options.today ?? new Date());
  for (const section of sections) section[1] = applyExceptions(section[1], valid);
  sections[0]![1].push(...problems);

  const all = sections.flatMap(([, r]) => r);
  const status: Status = failed(all) ? 'FAIL' : all.some((r) => r.status === 'skip') ? 'INCOMPLETE' : 'PASS';
  return { sections, status };
}

/** Where each architecture lives, and what in it is data the pipeline maintains rather than approved text. */
const ARCHITECTURE_PATHS: Record<string, { dir: string; data: string[] }> = {
  'enterprise-architecture': { dir: 'enterprise-architecture', data: ['enterprise-architecture/landscape', 'enterprise-architecture/governance/exceptions.yaml', 'enterprise-architecture/governance/versions.yaml', 'enterprise-architecture/governance/secret-scan-allowlist.yaml', 'enterprise-architecture/governance/proposals'] },
  network: { dir: 'network', data: ['network/generated', 'network/observed'] },
  infrastructure: { dir: 'infrastructure', data: ['infrastructure/generated'] },
};
const pathsOf = (name: string) => ARCHITECTURE_PATHS[name] ?? { dir: join('platforms', name).replace(/\\/g, '/'), data: [] };

/**
 * AGT-04 and OWN-04: the candidate is judged against exactly an approved version of each
 * architecture it pins: the files of that architecture are the ones its version tag points to,
 * with nothing changed, committed or not. Anything else can't produce a pass. (The data the
 * pipeline maintains, like the landscape, isn't versioned text; two-person control covers it.)
 */
export function checkApprovedArchitecture(names: string[], root = REPO_ROOT): Result[] {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const head = git('rev-parse', '--short', 'HEAD');
  if (head.status !== 0) return [skip('AGT-04', 'The architecture is not a Git checkout, so no approved version can be shown. Judge it against a checkout of the version tags.')];
  return names.map((name) => {
    const { dir, data } = pathsOf(name);
    const version = checkoutVersion(name);
    const tag = `${name}/v${version}`;
    if (!version || git('rev-parse', '-q', '--verify', `refs/tags/${tag}`).status !== 0) return skip('AGT-04', `${name} ${version ?? '?'} has no tag ${tag}: it isn't an approved version.`);
    const scope = ['--', dir, ...data.map((d) => `:(exclude)${d}`)];
    const changed = git('diff', '--name-only', tag, ...scope).stdout.trim();
    const uncommitted = git('status', '--porcelain', '--untracked-files=all', ...scope).stdout.trim();
    if (changed || uncommitted) {
      const files = [...changed.split('\n'), ...uncommitted.split('\n').map((l) => l.slice(3))].filter(Boolean);
      return skip('AGT-04', `${name} differs from its approved version ${tag} (${files.slice(0, 5).join(', ')}${files.length > 5 ? ', ...' : ''}): not what the Board approved, so nothing judged against it can pass.`);
    }
    return pass('AGT-04', `Judged against ${name} ${version}, exactly as tagged ${tag} (commit ${head.stdout.trim()}).`);
  });
}

/** The version of each architecture in this checkout, from its VERSION file. */
function checkoutVersion(name: string): string | undefined {
  const dir = ['enterprise-architecture', 'network', 'infrastructure'].includes(name) ? name : join('platforms', name);
  const file = join(REPO_ROOT, dir, 'VERSION');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : undefined;
}

/**
 * OWN-04: the candidate is judged against the versions it pins. This checkout holds one version of
 * each architecture; a pinned version of another major isn't in it, so the stage can't judge that
 * candidate here and says so. Rules the Board made mandatory immediately apply whatever is pinned.
 */
export function checkPinnedVersions(pins: Record<string, string>): Result[] {
  const results: Result[] = [];
  for (const [name, pinned] of Object.entries(pins)) {
    const here = checkoutVersion(name);
    const major = (v: string) => v.split('.')[0];
    if (!here) results.push(skip('OWN-04', `${name} isn't in this checkout, so the candidate can't be judged against ${name} ${pinned} here.`));
    else if (here === pinned) results.push(pass('OWN-04', `Judged against ${name} ${pinned}, as pinned.`));
    else if (major(here) === major(pinned) && here.localeCompare(pinned, undefined, { numeric: true }) > 0) {
      results.push(pass('OWN-04', `Pins ${name} ${pinned}; judged against ${here}, a later minor version, which never makes rules stricter.`));
    } else {
      results.push(skip('OWN-04', `Pins ${name} ${pinned}, but this checkout is ${name} ${here}. Judge it against the tag ${name}/v${pinned}.`));
    }
  }
  const versions = readYaml<{ 'mandatory-immediately'?: { rule: string; 'from-version'?: string; reason?: string; since?: string }[] | null }>(
    join(REPO_ROOT, 'enterprise-architecture', 'governance', 'versions.yaml'));
  for (const m of versions['mandatory-immediately'] ?? []) {
    results.push(warn(m.rule, `Mandatory immediately since ${m.since ?? '?'}, whatever version is pinned: ${m.reason ?? 'see versions.yaml'}. Judged against the current text${m['from-version'] ? ` (${m['from-version']})` : ''}; the Governance Agent reviews it.`));
  }
  return results;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { candidate: { type: 'string' }, today: { type: 'string' }, isolated: { type: 'boolean', default: false }, verbose: { type: 'boolean', default: false } } });
  const appDir = resolve(positionals[0] ?? '.');
  const candidateDir = values.candidate ? resolve(appDir, values.candidate) : undefined;
  const today = values.today ? new Date(`${values.today}T12:00:00Z`) : undefined;
  if (values.today && (!/^\d{4}-\d{2}-\d{2}$/.test(values.today) || Number.isNaN(today!.getTime()))) {
    console.error(`--today must be a date (YYYY-MM-DD), not "${values.today}".`);
    process.exit(2);
  }
  const { sections, status } = runPipeline(appDir, { candidateDir, isolated: values.isolated, ...(today ? { today } : {}) });
  console.log(`# Deterministic stage: ${appDir.replace(REPO_ROOT, '').replace(/^[\\/]/, '')}\n`);
  for (const [title, results] of sections) console.log(format(title, results, { verbose: values.verbose }));
  const all = sections.flatMap(([, r]) => r);
  const skipped = all.filter((r) => r.status === 'skip').length;
  console.log(`**Deterministic stage: ${status}**${status === 'INCOMPLETE' ? ` (${skipped} mandatory checks didn't run: see above. Incomplete blocks the verdict like a failure.)` : ''}`);
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
  process.exitCode = EXIT_CODE[status];
}

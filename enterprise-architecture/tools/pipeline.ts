// The deterministic stage of the central pipeline (pipeline/README.md, stage 3), for one
// application. The Governance Agent runs this and includes the output in its verdict.
//
// Usage: npm run pipeline -- <application repository> [--candidate releases/<id>] [--today YYYY-MM-DD]
//
// Three results, because a check that didn't run proves nothing:
//   PASS        every mandatory check ran and passed                    exit 0
//   FAIL        at least one check failed                               exit 1
//   INCOMPLETE  nothing failed, but a mandatory check couldn't run      exit 3
// Only PASS lets the stage pass. A check that can't run is reported as SKIPPED, never as passed.
//
// Nothing here runs the candidate's code (SEC-13): every check reads files. The candidate's tests
// ran in the Problem Owner's environment; their results are audited here (audit-results.ts).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { auditResults } from './audit-results.ts';
import { verifyInfrastructure } from '../../infrastructure/tools/verify.ts';
import { verifyNetwork } from '../../network/tools/verify.ts';
import { checkDeployment, checkGovernanceFiles } from './check-deployment.ts';
import { checkDependencies } from './check-dependencies.ts';
import { checkImages } from './check-images.ts';
import { checkIntent } from './check-intent.ts';
import { checkLinks } from './check-links.ts';
import { REPO_ROOT, intentChanges, loadManifest, loadModel, loadPlatform, readYaml, withApplications } from './lib/load.ts';
import type { Landscape } from './lib/model.ts';
import { applyExceptions, exceptionsFor } from './lib/exceptions.ts';
import { fail, failed, format, pass, skip, warn, type Result } from './lib/report.ts';
import { scanSecrets } from './scan-secrets.ts';
import { validateManifest } from './validate-manifest.ts';
import { GATE_INPUTS, judgeGateChanges } from './verify-gate-inputs.ts';

interface Candidate { id: string; application: string; purpose: string }

/**
 * What the Board has accepted for the shared systems (OWN-10), on every candidate: each valid
 * exception is a warning that cites it, and one that isn't valid any more is a failure (SIM-07).
 */
export function sharedSystemExceptions(today: Date, root = REPO_ROOT): Result[] {
  const results: Result[] = [];
  const shared = readYaml<Landscape>(join(root, 'enterprise-architecture', 'landscape', 'landscape.yaml'))['shared-systems'] ?? {};
  for (const name of Object.keys(shared)) {
    const { valid, problems } = exceptionsFor(name, today, root);
    for (const e of valid) results.push(warn(e.rules.join(', '), `${name}: ${e.finding}. Accepted by the Board as ${e.id} until ${e.expires}; compensating controls: ${e['compensating-controls'].trim()}`));
    results.push(...problems);
  }
  return results.length ? results : [pass('SIM-07', 'No exceptions for the shared systems.')];
}

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

export function runPipeline(appDir: string, options: { candidateDir?: string | undefined; today?: Date } = {}): { sections: [string, Result[]][]; status: Status } {
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
  intake.push(...checkGovernanceFiles());
  sections.push(['Intake and manifest', intake]);
  sections.push(['Intent (AGT-12)', checkIntent(appDir, { candidateDir: options.candidateDir })]);

  sections.push(['Secrets (SEC-03)', scanSecrets(appDir)]);
  sections.push(['Dependencies (SIM-01, SIM-05, SEC-05)', checkDependencies(appDir)]);
  sections.push(['Container images (SEC-05)', checkImages(appDir)]);
  // What this release's deployment does, against what the application was granted by name.
  sections.push(['Deployment (DEL-08, DEL-09)', checkDeployment(appDir, manifest, options.candidateDir)]);
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
  // What the Board accepted for the shared systems every application depends on, in view on every candidate.
  sections.push(['Shared systems (accepted exceptions)', sharedSystemExceptions(options.today ?? new Date())]);
  sections.push(['Documentation links', checkLinks()]);

  // The Test Agent's results, audited: the pipeline runs none of the candidate's code (SEC-13).
  sections.push([`Test results (DEL-02, ${manifest.runtime.technology})`, auditResults(appDir, platform, options.candidateDir)]);

  // Board exceptions: validated, then applied to exactly their rules for this application. An
  // invalid exception covers nothing, and is itself a failure.
  const { valid, problems } = exceptionsFor(manifest.application, options.today ?? new Date());
  for (const section of sections) section[1] = applyExceptions(section[1], valid);
  sections[0]![1].push(...problems);

  const all = sections.flatMap(([, r]) => r);
  const status: Status = failed(all) ? 'FAIL' : all.some((r) => r.status === 'skip') ? 'INCOMPLETE' : 'PASS';
  return { sections, status };
}

/**
 * Where each architecture lives, what in it is data the pipeline maintains rather than approved
 * text, and its template's manifest, if it has one.
 */
const ARCHITECTURE_PATHS: Record<string, { dir: string; data: string[]; template?: string }> = {
  'enterprise-architecture': { dir: 'enterprise-architecture', template: 'enterprise-architecture/templates/architecture.yaml', data: ['enterprise-architecture/landscape', 'enterprise-architecture/governance/exceptions', 'enterprise-architecture/governance/deployment-grants', 'enterprise-architecture/governance/versions.yaml', 'enterprise-architecture/governance/secret-scan-allowlist.yaml', 'enterprise-architecture/governance/proposals'] },
  network: { dir: 'network', data: ['network/generated', 'network/observed'] },
  infrastructure: { dir: 'infrastructure', data: ['infrastructure/generated'] },
};
const pathsOf = (name: string) => ARCHITECTURE_PATHS[name] ?? { dir: `platforms/${name}`, data: [], template: `platforms/${name}/template/architecture.yaml` };
/** Every architecture in a checkout: the central ones, and each platform with a VERSION file. */
export const architectureNames = (root = REPO_ROOT): string[] => [
  ...Object.keys(ARCHITECTURE_PATHS),
  ...(existsSync(join(root, 'platforms')) ? readdirSync(join(root, 'platforms')).filter((p) => existsSync(join(root, 'platforms', p, 'VERSION'))) : []),
].filter((name) => checkoutVersion(name, root));

/**
 * The files of an architecture that differ from a tag, committed or not. A template's pins don't
 * count: they follow the other architectures' releases, and nothing is judged against a template.
 * Every other change to a template's manifest does.
 */
export function changedSince(name: string, tag: string, root = REPO_ROOT): string[] {
  const git = (...args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const { dir, data, template: pins } = pathsOf(name);
  const scope = ['--', dir, ...data.map((d) => `:(exclude)${d}`)];
  const changed = git('diff', '--name-only', tag, ...scope).stdout.split('\n');
  const uncommitted = git('status', '--porcelain', '--untracked-files=all', ...scope).stdout.split('\n').map((l) => l.slice(3));
  const withoutPins = (text: string | undefined) => {
    if (text === undefined) return undefined;
    const { architecture: _, ...rest } = (parse(text) ?? {}) as Record<string, unknown>;
    return JSON.stringify(rest);
  };
  const onlyPins = () => {
    if (!pins) return false;
    const before = git('show', `${tag}:${pins}`);
    const now = existsSync(join(root, pins)) ? readFileSync(join(root, pins), 'utf8') : undefined;
    return before.status === 0 && now !== undefined && withoutPins(before.stdout) === withoutPins(now);
  };
  return [...new Set([...changed, ...uncommitted].filter(Boolean))].filter((f) => f !== pins || !onlyPins());
}

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
    const version = checkoutVersion(name, root);
    const tag = `${name}/v${version}`;
    if (!version || git('rev-parse', '-q', '--verify', `refs/tags/${tag}`).status !== 0) return skip('AGT-04', `${name} ${version ?? '?'} has no tag ${tag}: it isn't an approved version.`);
    const files = changedSince(name, tag, root);
    if (files.length) return skip('AGT-04', `${name} differs from its approved version ${tag} (${files.slice(0, 5).join(', ')}${files.length > 5 ? ', ...' : ''}): not what the Board approved, so nothing judged against it can pass.`);
    return pass('AGT-04', `Judged against ${name} ${version}, exactly as tagged ${tag} (commit ${head.stdout.trim()}).`);
  });
}

/** The version of each architecture in this checkout, from its VERSION file. */
export function checkoutVersion(name: string, root = REPO_ROOT): string | undefined {
  const dir = ['enterprise-architecture', 'network', 'infrastructure'].includes(name) ? name : join('platforms', name);
  const file = join(root, dir, 'VERSION');
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
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { candidate: { type: 'string' }, today: { type: 'string' }, verbose: { type: 'boolean', default: false } } });
  const appDir = resolve(positionals[0] ?? '.');
  const candidateDir = values.candidate ? resolve(appDir, values.candidate) : undefined;
  const today = values.today ? new Date(`${values.today}T12:00:00Z`) : undefined;
  if (values.today && (!/^\d{4}-\d{2}-\d{2}$/.test(values.today) || Number.isNaN(today!.getTime()))) {
    console.error(`--today must be a date (YYYY-MM-DD), not "${values.today}".`);
    process.exit(2);
  }
  const { sections, status } = runPipeline(appDir, { candidateDir, ...(today ? { today } : {}) });
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
    "the Security Agent's review (SEC-12).",
    'The Governance Agent judges these, and the review rules, before any verdict.',
  ].join('\n'));
  const platform = loadPlatform(loadManifest(appDir).runtime.technology);
  if (platform?.['required-evidence']?.length) {
    console.log(`\nAlso required on ${platform.platform}, not automated here:\n${platform['required-evidence'].map((e) => `- ${e}`).join('\n')}`);
  }
  process.exitCode = EXIT_CODE[status];
}

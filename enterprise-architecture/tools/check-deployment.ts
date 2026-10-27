// DEL-08 and DEL-09: what a release's deployment may do, and how each of its steps is undone.
// - Every step of the plan (releases/<id>/deployment-plan.yaml), and of its rollbacks, is a
//   pre-approved action for the application's platform (pipeline/deployment-actions.yaml), on a
//   target the application was granted by name (governance/deployment-grants/<application>.yaml).
//   Nothing is granted by default.
// - Every step says whether the application must stop for it; a class A or B service in the
//   datacenters never stops, because it is deployed rolling.
// - Every step that changes production is covered by exactly one rollback, which contains what
//   undoes it, on the same target: one action, or a group of actions that only undo it together
//   (an Android release, AND-13). Migrations included: their down migrations, or a restore of a
//   backup taken earlier in the same plan (DAT-07).
// - A unit asks for no more than a workload may have (SEC-09).
// It also checks the Board's own files: each is named after something in the landscape, and each
// grant says who approved it and why.
//
// Usage: node enterprise-architecture/tools/check-deployment.ts <application repository> --candidate releases/<id>

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { REPO_ROOT, governanceFiles, loadGrants, loadManifest, loadPlatform, readYaml } from './lib/load.ts';
import type { DeploymentAction, DeploymentPlan, Grant, Landscape, Manifest, PlanStep } from './lib/model.ts';
import { fail, pass, report, skip, type Result } from './lib/report.ts';

export function loadActions(root = REPO_ROOT): Record<string, DeploymentAction> {
  return readYaml<{ actions: Record<string, DeploymentAction> }>(join(root, 'enterprise-architecture', 'pipeline', 'deployment-actions.yaml')).actions;
}

/** What isn't an action, and where it goes instead. */
function elsewhere(action: string): Result | undefined {
  if (/firewall|nft|iptables|rout|network|egress|proxy|port-open/i.test(action)) {
    return fail('OWN-10', `"${action}" isn't a deployment action: the network is a shared system, and only its steward, the Network Agent, changes its rules.`, 'Declare the flow in the manifest, on both sides (ZTN-02). The Governance Agent escalates it to the Network Agent, which changes the network\'s rules; it goes to the Architecture Board if it would break intent declared earlier.');
  }
  if (/load-?balancer|haproxy|dns|secret|alert|mail|dlp|connector/i.test(action)) {
    return fail('OWN-10', `"${action}" isn't a deployment action: it changes a shared system, which only its steward changes.`, 'Declare the need in the manifest. The Governance Agent escalates it to the shared system\'s steward (landscape.yaml, shared-systems).');
  }
  if (/package|apt|dnf|yum|rpm|install|pip|npm-global/i.test(action)) {
    return fail('INF-11', `"${action}" isn't a deployment action: a package changes the host for every application on it.`, 'Ask Central IT for the package in a release of the infrastructure. This release then depends on that one.');
  }
  return undefined;
}

const ungranted = (step: PlanStep) => fail('DEL-08', `${step.action} on ${step.target} isn't granted to this application: a deployment does nothing it wasn't granted by name.`,
  'The Governance Agent escalates the request for this grant: to the steward of the shared system with the Governance Agent, or to the Architecture Board when it would break intent declared earlier (OWN-10). Until it is granted, the step can\'t be deployed.');

/** One step, of the plan or of a rollback: a known action for this platform, granted, and saying whether the application must stop. */
function checkStep(step: PlanStep, where: string, actions: Record<string, DeploymentAction>, grants: Grant[], runsOn: string | undefined): Result[] {
  const action = actions[step.action];
  if (!action) return [elsewhere(step.action) ?? fail('DEL-08', `${where}: "${step.action}" isn't a pre-approved deployment action.`, 'Use a pre-approved action, or ask the Architecture Board for a new one: a change to the architecture.')];
  const results: Result[] = [];
  if (runsOn && !action['runs-on'].includes(runsOn)) results.push(fail('DEL-08', `${where}: ${step.action} is an action for ${action['runs-on'].join(', ')}, not for this platform (${runsOn}).`));
  if (!step.target) results.push(fail('DEL-08', `${where}: ${step.action} names no target. A grant, and a step, are for one named thing.`));
  if (!['must-stop', 'keeps-running'].includes(step.application)) results.push(fail('DEL-09', `${where}: ${step.action} on ${step.target} doesn't say whether the application must stop for it ("application: must-stop" or "keeps-running").`));
  if (!grants.some((g) => g.action === step.action && g.target === step.target)) results.push(ungranted(step));
  return results;
}

/** SEC-09: what a unit file asks for, against what a workload may have. */
export function unitProblems(text: string): string[] {
  const problems: string[] = [];
  const value = (key: string) => [...text.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'gm'))].map((m) => m[1]!.trim());
  const user = value('User');
  if (!user.length || user.some((u) => u === 'root' || u === '0')) problems.push('it runs as root (no User=, or User=root)');
  for (const k of ['AmbientCapabilities', 'CapabilityBoundingSet']) if (value(k).some((v) => v && v !== '~' && !v.startsWith('~'))) problems.push(`it adds capabilities (${k})`);
  if (value('NoNewPrivileges').some((v) => /^(no|false|0)$/i.test(v))) problems.push('it allows new privileges (NoNewPrivileges=no)');
  if (value('PermissionsStartOnly').some((v) => /^(yes|true|1)$/i.test(v)) || value('ExecStartPre').some((v) => v.startsWith('+'))) problems.push('it runs a step with full privileges (ExecStartPre=+ or PermissionsStartOnly)');
  return problems;
}

/** The deployment plan of a release candidate, against the grants in this architecture (never the candidate's). */
export function checkDeployment(appDir: string, manifest: Manifest, candidateDir: string | undefined, root = REPO_ROOT): Result[] {
  if (!candidateDir) return [skip('DEL-09', 'No release candidate given, so there is no deployment plan to check.')];
  const file = join(candidateDir, 'deployment-plan.yaml');
  if (!existsSync(file)) return [fail('DEL-09', `No deployment plan: ${file} doesn't exist. A release deploys only what its plan says, and nothing without one.`, 'Write releases/<id>/deployment-plan.yaml: its steps, from the pre-approved actions, and a rollback for each.')];
  const plan = readYaml<DeploymentPlan | null>(file);
  const steps = plan?.steps ?? [];
  const rollbacks = plan?.rollbacks ?? [];
  if (!steps.length) return [fail('DEL-09', 'The deployment plan has no steps. Even releasing the application is a step.')];

  const actions = loadActions(root);
  const grants = loadGrants(manifest.application, root);
  const runsOn = loadPlatform(manifest.runtime?.technology ?? '', root)?.['runs-on'];
  const results: Result[] = [];
  const ids = steps.map((s) => s.id);
  for (const [i, s] of steps.entries()) {
    const where = `Step ${s.id ?? i + 1}`;
    if (!s.id) results.push(fail('DEL-09', `${where} has no id, so no rollback can say it covers it.`));
    else if (ids.indexOf(s.id) !== i) results.push(fail('DEL-09', `Two steps are called ${s.id}.`));
    results.push(...checkStep(s, where, actions, grants, runsOn));
    if (actions[s.action]?.['rollback-only']) results.push(fail('DEL-09', `${where}: ${s.action} is only for a rollback, never a step of its own.`));
  }
  for (const [i, r] of rollbacks.entries()) {
    for (const c of r.covers ?? []) if (!ids.includes(c)) results.push(fail('DEL-09', `Rollback ${i + 1} covers "${c}", which isn't a step of the plan.`));
    for (const s of r.steps ?? []) results.push(...checkStep(s, `Rollback ${i + 1}`, actions, grants, runsOn));
  }
  // Rolling, with serving instances throughout: a class A or B service in the datacenters never stops.
  if (runsOn === 'datacenters' && ['A', 'B'].includes(manifest.resilience?.class)) {
    for (const s of [...steps, ...rollbacks.flatMap((r) => r.steps ?? [])].filter((x) => x.application === 'must-stop')) {
      results.push(fail('DEL-09', `${s.action} on ${s.target} would stop a class ${manifest.resilience.class} service, which is deployed rolling and never has zero serving instances.`, 'Make the step one the previous version runs through (expand now, contract in a later release), and mark it "keeps-running".'));
    }
  }

  // Every step that changes production: exactly one rollback, with what undoes it on its target.
  for (const s of steps.filter((x) => x.id && actions[x.action]?.['changes-production'])) {
    const covering = rollbacks.filter((r) => r.covers?.includes(s.id!));
    if (covering.length !== 1) {
      results.push(fail('DEL-09', `Step ${s.id} (${s.action} on ${s.target}) is covered by ${covering.length} rollbacks; it must be covered by exactly one.`, 'Give it a rollback of its own, or add it to the one rollback that undoes it together with other steps.'));
      continue;
    }
    const rollback = (covering[0]!.steps ?? []).filter((u) => u.target === s.target).map((u) => u.action);
    const undone = (actions[s.action]!['undone-by'] ?? []).some((u) => {
      const group = [u].flat();
      let at = -1;
      return group.every((a) => (at = rollback.indexOf(a, at + 1)) >= 0);
    });
    const ways = (actions[s.action]!['undone-by'] ?? []).map((u) => [u].flat().join(' then ')).join(', or ');
    if (!undone) results.push(fail('DEL-09', `Step ${s.id} (${s.action} on ${s.target}) has a rollback, but nothing in it undoes it: on ${s.target}, it needs ${ways}.`));
    for (const u of (covering[0]!.steps ?? []).filter((x) => x.action === 'restore' && x.target === s.target)) {
      const backup = steps.findIndex((b) => b.id === u.from && b.action === 'backup' && b.target === s.target);
      if (backup < 0 || backup > steps.indexOf(s)) results.push(fail('DEL-09', `The restore of ${s.target} for step ${s.id} restores "${u.from ?? '?'}", which isn't a backup of ${s.target} earlier in the plan.`, 'Back it up in a step before the one that changes it, and restore from that step.'));
    }
    if (s.action === 'migrations') results.push(...checkMigrations(s, (covering[0]!.steps ?? []).filter((u) => u.target === s.target), appDir, candidateDir));
  }

  for (const s of steps.filter((x) => ['systemd-unit', 'scheduled-task'].includes(x.action) && x.file)) {
    const unit = join(appDir, s.file!);
    if (!existsSync(unit)) { results.push(fail('DEL-08', `Step ${s.id}: the unit file ${s.file} doesn't exist.`)); continue; }
    const problems = unitProblems(readFileSync(unit, 'utf8'));
    results.push(problems.length
      ? fail('SEC-09', `${s.file} asks for more than a workload may have: ${problems.join('; ')}.`, 'Run it as the application\'s own user, without added capabilities. Whatever needs more is a change to the infrastructure (INF-11).')
      : pass('SEC-09', `${s.file}: its own user, no added capabilities, no privileged steps.`));
  }

  if (!results.some((r) => r.status === 'fail')) results.push(pass('DEL-09', `The deployment plan's ${steps.length} steps are all granted, and each is covered by a rollback that undoes it.`));
  return results;
}

/** DAT-07: down migrations exist; a schema change the previous version runs through is proven by its tests. */
function checkMigrations(step: PlanStep, rollback: PlanStep[], appDir: string, candidateDir: string): Result[] {
  const results: Result[] = [];
  const files = step.files ?? [];
  if (!files.length) results.push(fail('DAT-07', `Step ${step.id}: migrations on ${step.target} lists no files.`));
  for (const f of files.filter((x) => !existsSync(join(appDir, x)))) results.push(fail('DAT-07', `Step ${step.id}: the migration ${f} doesn't exist.`));
  const down = rollback.filter((u) => u.action === 'migrations').flatMap((u) => u.files ?? []);
  if (rollback.some((u) => u.action === 'migrations')) {
    for (const f of files) {
      const expected = f.replace(/\.sql$/, '.down.sql');
      if (!down.includes(expected)) results.push(fail('DAT-07', `Step ${step.id}: the rollback doesn't run ${expected}, the down migration of ${f}.`));
      else if (!existsSync(join(appDir, expected))) results.push(fail('DAT-07', `Step ${step.id}: the down migration ${expected} doesn't exist.`));
    }
  }
  if (step.application === 'keeps-running') {
    const candidate = existsSync(join(candidateDir, 'candidate.yaml')) ? readYaml<{ evidence?: Record<string, unknown> }>(join(candidateDir, 'candidate.yaml')) : undefined;
    const evidence = candidate?.evidence?.['previous-release-tests'];
    if (typeof evidence !== 'string' || !existsSync(join(appDir, evidence))) {
      results.push(fail('DAT-07', `Step ${step.id} changes ${step.target}'s schema while the application keeps running, so the previous version must work on the new schema, and there is no proof it does.`,
        'The Test Agent runs the previous release\'s tests against the new schema, and the candidate records the result as evidence.previous-release-tests.'));
    }
  }
  return results;
}

/** The Board's files: each named after an application, a shared system or a site; each grant approved and explained. */
export function checkGovernanceFiles(root = REPO_ROOT): Result[] {
  const landscape = readYaml<Landscape>(join(root, 'enterprise-architecture', 'landscape', 'landscape.yaml'));
  const shared = landscape['shared-systems'] ?? {};
  const subjects = new Set([...Object.keys(landscape.services ?? {}), ...Object.keys(shared), ...Object.keys(landscape.sites ?? {})]);
  const stewards = new Set(Object.values(shared).map((s) => s.steward));
  const actions = loadActions(root);
  const results: Result[] = [];
  for (const [name, s] of Object.entries(shared)) {
    const missing = (['steward', 'covers', 'source'] as const).filter((k) => !s[k]?.trim());
    if (missing.length) results.push(fail('OWN-10', `The shared system ${name} has no ${missing.join(', ')}.`));
  }
  for (const kind of ['exceptions', 'deployment-grants'] as const) {
    for (const { subject, file } of governanceFiles(kind, root)) {
      if (!subjects.has(subject)) results.push(fail(kind === 'exceptions' ? 'SIM-07' : 'DEL-08', `governance/${kind}/${basename(file)} is for "${subject}", which isn't an application, shared system or site in the landscape: it covers nothing.`, 'Name the file after what it is for.'));
    }
  }
  for (const { subject } of governanceFiles('deployment-grants', root)) {
    const seen = new Set<string>();
    for (const g of loadGrants(subject, root)) {
      const problems: string[] = [];
      if (!g.id || seen.has(g.id)) problems.push(g.id ? 'its id is used twice' : 'it has no id');
      seen.add(g.id);
      if (!actions[g.action]) problems.push(`"${g.action}" isn't a pre-approved action`);
      if (!g.target) problems.push('it names no target');
      if (!g.reason?.trim()) problems.push('it has no reason: no decision without intent');
      const by = g['approved-by'] ?? [];
      if (!(by.includes('board') || (by.includes('governance-agent') && by.some((b) => stewards.has(b))))) problems.push('it isn\'t approved by the Architecture Board, nor by a steward together with the Governance Agent');
      if (Number.isNaN(new Date(g.granted).getTime())) problems.push('it has no valid granted date');
      if (g.record && !existsSync(join(root, g.record))) problems.push(`its record ${g.record} doesn't exist`);
      if (problems.length) results.push(fail('DEL-08', `Grant ${g.id ?? '?'} for ${subject} grants nothing: ${problems.join('; ')}.`, 'Ask the Architecture Board, or the steward, to correct it.'));
    }
  }
  return results.length ? results : [pass('DEL-08', 'Every exception and grant file is for something in the landscape, and every grant is approved and explained.')];
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { candidate: { type: 'string' } } });
  const appDir = resolve(positionals[0] ?? '.');
  report(`Deployment (DEL-08, DEL-09): ${appDir}`, [...checkGovernanceFiles(), ...checkDeployment(appDir, loadManifest(appDir), values.candidate ? resolve(appDir, values.candidate) : undefined)]);
}

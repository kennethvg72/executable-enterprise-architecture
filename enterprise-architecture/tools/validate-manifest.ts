// Validates an application's architecture.yaml against the rules that can be checked
// mechanically. Usage: node enterprise-architecture/tools/validate-manifest.ts <app-dir>

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REPO_ROOT, loadDirectory, loadExceptions, loadLandscape, loadManifest, loadPlatform, loadVersions } from './lib/load.ts';
import { CLASSIFICATION_ORDER, type Landscape, type Manifest } from './lib/model.ts';
import { fail, pass, report, warn, type Result } from './lib/report.ts';

const ISO_DURATION = /^P(?=\d)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Options {
  root?: string;
  landscape?: Landscape;
  today?: Date;
}

export function validateManifest(appDir: string, manifest: Manifest, options: Options = {}): Result[] {
  const root = options.root ?? REPO_ROOT;
  const landscape = options.landscape ?? loadLandscape(root);
  const today = options.today ?? new Date();
  const results: Result[] = [];
  const m = manifest;

  // ---- Completeness
  const required: [string, unknown][] = [
    ['application', m.application],
    ['description', m.description],
    ['problem-owner', m['problem-owner']],
    ['architecture', m.architecture],
    ['exposure', m.exposure],
    ['users', m.users],
    ['resilience', m.resilience],
    ['runtime', m.runtime],
  ];
  const missing = required.filter(([, v]) => v === undefined || v === null || v === '').map(([k]) => k);
  if (missing.length) {
    results.push(fail('MANIFEST', `Missing fields: ${missing.join(', ')}.`, 'Copy the missing fields from enterprise-architecture/templates/architecture.yaml.'));
    return results; // nothing else can be checked reliably
  }
  results.push(pass('MANIFEST', 'All required fields present.'));

  // Text still as the template left it: to be decided with the Problem Owner, not by an agent.
  const placeholders: string[] = [];
  if (/^One sentence\./.test(m.description.trim())) placeholders.push('description');
  if (/In the Problem Owner's words/.test(m.resilience?.statement ?? '')) placeholders.push('resilience.statement');
  if (/^my-(application|power-app|android-app)$/.test(m.application)) placeholders.push('application (the name)');
  if (placeholders.length) {
    results.push(fail('MANIFEST', `Still the template's placeholder: ${placeholders.join(', ')}.`, 'Fill these in together with the Problem Owner, in their words.'));
  }

  // ---- The platform the Problem Owner chose, and its limits (platforms/<name>/platform.yaml)
  const platform = loadPlatform(m.runtime.technology, root);
  if (!platform) {
    results.push(fail('PLATFORM', `"${m.runtime.technology}" is not a NATAX platform.`, 'Use one of the platforms in platforms/ (typescript-web, power-apps, android), or propose a new one to the Architecture Board.'));
    return results;
  }
  const limits: string[] = [];
  if (!platform['resilience-classes'].includes(m.resilience.class)) limits.push(`resilience class ${m.resilience.class} (allowed: ${platform['resilience-classes'].join(', ')})`);
  if (!platform.exposure.includes(m.exposure)) limits.push(`${m.exposure} exposure (allowed: ${platform.exposure.join(', ')})`);
  const maxIndex = CLASSIFICATION_ORDER.indexOf(platform['max-classification'] as never);
  for (const d of m.data ?? []) {
    // An unknown classification (a typo, say) is never "within the limits".
    if (!CLASSIFICATION_ORDER.includes(d.classification)) limits.push(`unknown classification "${d.classification}" for ${d.store} (use ${CLASSIFICATION_ORDER.join(', ')})`);
    else if (CLASSIFICATION_ORDER.indexOf(d.classification) > maxIndex) limits.push(`${d.classification} data in ${d.store} (at most ${platform['max-classification']})`);
  }
  results.push(limits.length
    ? fail('PLATFORM', `${platform.platform} doesn't allow: ${limits.join('; ')}.`, `Choose a platform that fits (platforms/README.md), or change the design. The limits are in platforms/${platform.platform}/platform.yaml.`)
    : pass('PLATFORM', `Fits the limits of ${platform.platform}.`));

  // ---- SIM-09: looked for an existing application before building a new one
  const check = m['landscape-check'];
  if (!check) {
    results.push(fail('SIM-09', 'No landscape check recorded.', 'Check enterprise-architecture/landscape/landscape.md for comparable applications, talk to their owners, and record the outcome in a decision record; name it in landscape-check.'));
  } else if (!existsSync(join(appDir, check))) {
    results.push(fail('SIM-09', `The landscape check ${check} does not exist.`, `Write ${check}.`));
  } else if (/Use it \| extend it \| build anyway|<Problem Owner>/.test(readFileSync(join(appDir, check), 'utf8'))) {
    results.push(fail('SIM-09', `The landscape check ${check} is still the template.`, 'Record what was looked at in landscape.md, who was asked, and the outcome.'));
  } else {
    results.push(pass('SIM-09', `Landscape check recorded in ${check}.`));
  }

  // ---- OWN-01: a named, active Problem Owner
  const person = loadDirectory(root).find((p) => p.id === m['problem-owner']);
  if (!person) {
    results.push(fail('OWN-01', `Problem Owner "${m['problem-owner']}" is not in the workforce directory.`, 'Name a person by their workforce directory id.'));
  } else if (person.status !== 'active') {
    results.push(fail('OWN-01', `Problem Owner ${person.name} is no longer an active employee.`, 'Find a new Problem Owner within 30 days, or the application will be decommissioned (OWN-02).'));
  } else {
    results.push(pass('OWN-01', `Problem Owner: ${person.name}, ${person.title}.`));
  }

  // ---- OWN-03: limits for applications without a Technical Owner
  const highestData = (m.data ?? []).reduce(
    (max, d) => Math.max(max, CLASSIFICATION_ORDER.indexOf(d.classification)),
    0,
  );
  const needsTechnicalOwner: string[] = [];
  if (m.resilience.class === 'A') needsTechnicalOwner.push('resilience class A');
  if (m.exposure === 'internet' || m.exposure === 'staff-edge') needsTechnicalOwner.push(`${m.exposure} exposure`);
  if (highestData >= CLASSIFICATION_ORDER.indexOf('taxpayer-restricted')) needsTechnicalOwner.push('taxpayer-restricted data');
  if (needsTechnicalOwner.length && !m['technical-owner']) {
    results.push(fail('OWN-03', `A Technical Owner is required because of: ${needsTechnicalOwner.join(', ')}.`, 'Name a professional engineering team as technical-owner, or remove the reason it is required.'));
  } else {
    results.push(pass('OWN-03', m['technical-owner'] ? `Technical Owner: ${m['technical-owner']}.` : 'No Technical Owner required.'));
  }

  // ---- OWN-04: pinned architecture versions exist and are usable
  const versions = loadVersions(root);
  // The always-applied architectures, plus the chosen platform's.
  const mustPin = ['enterprise-architecture', 'network', 'infrastructure', m.runtime.technology];
  for (const name of mustPin) {
    if (!m.architecture[name]) {
      results.push(fail('OWN-04', `No version pinned for ${name}.`, `Add "${name}: <version>" under architecture, using an active version from governance/versions.yaml.`));
    }
  }
  for (const [name, version] of Object.entries(m.architecture)) {
    const entry = versions[name]?.find((v) => v.version === String(version));
    if (!entry) {
      results.push(fail('OWN-04', `${name} ${version} does not exist.`, `Pin an active version from governance/versions.yaml.`));
    } else if (entry.status === 'active') {
      results.push(pass('OWN-04', `${name} ${version} is active.`));
    } else if (entry.status === 'deprecated') {
      results.push(warn('OWN-04', `${name} ${version} is deprecated${entry['decommission-date'] ? ` and decommissioned on ${entry['decommission-date']}` : ''}.`, 'Plan the migration to the active version.'));
    } else {
      results.push(fail('OWN-04', `${name} ${version} is ${entry.status}.`, 'Migrate to an active version; only migrations can be released until then.'));
    }
  }

  // ---- IAM-01: one identity provider, and the right one
  const idp = m.users['identity-provider'];
  if (idp !== 'workforce' && idp !== 'customer') {
    results.push(fail('IAM-01', `Unknown identity provider "${idp}".`, 'Use workforce or customer.'));
  } else {
    const wrongIdp = (m.consumes ?? []).find((c) =>
      idp === 'workforce' ? c.service === 'customer-idp' : c.external === 'workforce-idp');
    if (wrongIdp) {
      results.push(fail('IAM-01', `Users sign in with the ${idp} IdP, but the application consumes the other identity provider.`, 'Remove the other identity provider; an application serves either staff or customers.'));
    } else if (m.exposure === 'internet' && idp === 'workforce') {
      results.push(fail('IAM-01', 'Internet-exposed applications are for customers. Staff use internal applications, or staff-edge APIs from managed devices.', 'Set exposure to internal or staff-edge, or use the customer IdP.'));
    } else if (m.exposure === 'staff-edge' && idp !== 'workforce') {
      results.push(fail('IAM-01', 'staff-edge APIs serve staff on managed devices, with the workforce IdP.', 'Use the workforce IdP, or exposure internet for customers.'));
    } else {
      results.push(pass('IAM-01', `Users sign in with the ${idp} IdP.`));
    }
  }

  // ---- IAM-04: roles assigned through IdP groups
  if (!m.users.roles?.length) {
    results.push(fail('IAM-04', 'No roles defined.', 'Define at least one role, assigned through an IdP group.'));
  } else if (m.users.roles.some((r) => !r.group)) {
    results.push(fail('IAM-04', 'Every role must be assigned through an IdP group.', 'Add a group to each role.'));
  } else {
    results.push(pass('IAM-04', `${m.users.roles.length} role(s), each assigned through an IdP group.`));
  }

  // ---- DAT-01, DAT-05, DAT-06: declared data stores, on the stores the platform allows
  const inDatacenters = platform['runs-on'] === 'datacenters';
  for (const d of m.data ?? []) {
    if (!inDatacenters) {
      // Power Apps keep data in Dataverse or SharePoint, Android on the device: the platform names its stores.
      results.push(platform['data-stores'].includes(d.store)
        ? pass('DAT-06', `${d.store}: a store ${platform.platform} allows, holding ${d.classification} data.`)
        : fail('DAT-06', `${platform.platform} applications keep data in ${platform['data-stores'].join(' or ')}, not "${d.store}".`, `See platforms/${platform.platform}/standards.md.`));
      if (!d.retention || !ISO_DURATION.test(d.retention)) {
        results.push(fail('DAT-05', `${d.store} has no valid retention period ("${d.retention ?? ''}").`, 'Set retention as an ISO 8601 duration, for example P18M.'));
      }
      continue;
    }
    const cluster = landscape.services[d.store];
    if (!cluster || cluster.kind !== 'database-cluster') {
      results.push(fail('DAT-06', `Data store "${d.store}" is not a PostgreSQL cluster in the landscape.`, 'Use app-db (up to confidential) or core-db (taxpayer-restricted), or record why PostgreSQL cannot meet the need.'));
      continue;
    }
    if (!CLASSIFICATION_ORDER.includes(d.classification)) {
      results.push(fail('DAT-01', `Unknown classification "${d.classification}" for ${d.database}.`, `Use one of: ${CLASSIFICATION_ORDER.join(', ')}.`));
    } else if (cluster.classification && CLASSIFICATION_ORDER.indexOf(d.classification) > CLASSIFICATION_ORDER.indexOf(cluster.classification)) {
      results.push(fail('DAT-01', `${d.database} holds ${d.classification} data, but ${d.store} only accepts up to ${cluster.classification}.`, 'Use core-db for taxpayer-restricted data, or stop storing it (DAT-02).'));
    } else {
      results.push(pass('DAT-01', `${d.store}/${d.database}: ${d.classification}.`));
    }
    if (!d.retention || !ISO_DURATION.test(d.retention)) {
      results.push(fail('DAT-05', `${d.database} has no valid retention period ("${d.retention ?? ''}").`, 'Set retention as an ISO 8601 duration, for example P18M.'));
    } else {
      results.push(pass('DAT-05', `${d.database} retention ${d.retention}.`));
    }
    const provisioned = cluster.databases?.some((db) => db.name === d.database && db.owner === m.application);
    if (!provisioned) {
      results.push(fail('DAT-06', `Database ${d.database} is not provisioned on ${d.store} for ${m.application}.`, `Central IT adds { name: ${d.database}, owner: ${m.application} } to ${d.store}.databases in landscape.yaml.`));
    }
  }

  // ---- RES-01, RES-02: resilience stated, and placement matches the class
  const statement = m.resilience.statement?.trim() ?? '';
  if (!['A', 'B', 'C'].includes(m.resilience.class)) {
    results.push(fail('RES-01', `Unknown resilience class "${m.resilience.class}".`, 'Use A, B or C.'));
  } else if (statement.length < 40) {
    results.push(fail('RES-01', 'The resilience statement is missing or too short to be meaningful.', 'Ask the Problem Owner how long users can manage without it, how much data they could lose, and when it matters most.'));
  } else {
    results.push(pass('RES-01', `Class ${m.resilience.class}, with a statement from the Problem Owner.`));
  }
  if (!inDatacenters) {
    results.push(pass('RES-02', platform['runs-on'] === 'devices'
      ? `Runs on devices: availability is the backend's, which RES-02 applies to (RES-11).`
      : `Runs on ${platform.platform}, a SaaS platform whose availability the Board accepted once (RES-11).`));
  } else if (m.resilience.class !== 'C' && !(m.runtime.sites?.includes('dc1') && m.runtime.sites?.includes('dc2'))) {
    results.push(fail('RES-02', `Class ${m.resilience.class} services must run in both dc1 and dc2.`, 'Set runtime.sites to [dc1, dc2].'));
  } else {
    results.push(pass('RES-02', `Runs in ${m.runtime.sites.join(' and ')}.`));
  }

  // ---- RES-06 / OBS-03: readiness health checks on everything provided
  for (const p of m.provides ?? []) {
    if (!p.health?.path || p.health.path === '/' || !p.health.path.includes('ready')) {
      results.push(fail('RES-06', `Interface "${p.name}" has no readiness health check.`, 'Set health to { port: <port>, path: /health/ready }.'));
    } else {
      results.push(pass('RES-06', `Interface "${p.name}" is checked at ${p.health.path}.`));
    }
  }

  // ---- INT-02, INT-05: no new broker consumers, no direct externals that belong to a shared service
  for (const c of m.consumes ?? []) {
    if (c.service) {
      const provider = landscape.services[c.service];
      if (!provider && !landscape.placements?.[c.service]) {
        results.push(fail('INT-01', `Consumes unknown service "${c.service}".`, 'Use a service from the landscape, through its published interface.'));
      } else if (provider?.contained) {
        results.push(fail('INT-02', `${c.service} is contained; no new consumers are allowed.`, 'Integrate through the owning system\'s API, or a queue table in your own PostgreSQL database.'));
      }
      if (!c.purpose) results.push(warn('INT-03', `No purpose given for consuming ${c.service}.`, 'Say why, so reviewers and the network policy can explain the path.'));
    }
    if (c.external) {
      const ext = landscape.externals[c.external];
      if (!ext) {
        results.push(fail('INT-05', `Consumes unknown external "${c.external}".`, 'Externals are registered by Central IT in landscape.yaml.'));
      } else if (ext.consumers !== 'any' && !ext.consumers.includes(m.application)) {
        results.push(fail('INT-05', `Only ${ext.consumers.join(', ')} may reach ${c.external}.`, `Use the shared service that owns ${c.external} instead (see INT-05).`));
      }
    }
  }

  // ---- OBS-04: alerts with owners and runbooks
  if (!m.alerts?.length) {
    results.push(fail('OBS-04', 'No alerts defined.', 'Define at least a readiness alert with an owner and a runbook.'));
  }
  for (const a of m.alerts ?? []) {
    if (!a.owner || !a.runbook) {
      results.push(fail('OBS-04', `Alert ${a.name} needs an owner and a runbook.`, 'Add owner and runbook.'));
    } else if (!existsSync(join(appDir, a.runbook))) {
      results.push(fail('OBS-04', `Runbook ${a.runbook} for alert ${a.name} does not exist.`, `Write ${a.runbook}.`));
    } else {
      results.push(pass('OBS-04', `Alert ${a.name}: runbook present.`));
    }
  }

  // ---- SIM-07: temporary complexity and Board exceptions end when they say they do
  const exceptions = loadExceptions(root).filter((e) => e.application === m.application);
  for (const e of exceptions) {
    results.push(pass('EXCEPTION', `${e.id} covers ${e.rules.join(', ')} until ${e.expires}.`));
  }
  const dated = [
    ...(m.temporary ?? []).map((t) => ({ what: t.what, date: t['remove-by'], rule: 'SIM-07' })),
    ...exceptions.map((e) => ({ what: `exception ${e.id} to ${e.rules.join(', ')}`, date: e.expires, rule: 'SIM-07' })),
  ];
  for (const t of dated) {
    const due = new Date(t.date);
    if (Number.isNaN(due.getTime())) {
      results.push(fail(t.rule, `"${t.what}" has no valid end date.`, 'Give it an end date (YYYY-MM-DD).'));
    } else if (due.getTime() < today.getTime()) {
      results.push(fail(t.rule, `"${t.what}" passed its end date (${t.date}).`, 'Remove it, or ask the Architecture Board for a new date with a reason.'));
    } else if (due.getTime() - today.getTime() < 30 * DAY_MS) {
      results.push(warn(t.rule, `"${t.what}" ends within 30 days (${t.date}).`, 'Plan its removal now.'));
    }
  }

  return results;
}

if (import.meta.main) {
  const appDir = resolve(process.argv[2] ?? '.');
  report(`Manifest: ${appDir}`, validateManifest(appDir, loadManifest(appDir)));
}
